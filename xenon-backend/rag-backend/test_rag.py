import os
import json
import re
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS

# If installing failed during hackathon, script won't crash instantly
try:
    import ifcopenshell
    import ifcopenshell.util.element
    IFC_AVAILABLE = True
except ImportError:
    IFC_AVAILABLE = False


def build_pdf_if_missing(filepath):
    if not os.path.exists(filepath):
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        try:
            from reportlab.pdfgen import canvas
            c = canvas.Canvas(filepath)
            c.drawString(100, 750, "IS 3362:1977 Code of Practice for Natural Ventilation of Residential Buildings.")
            c.drawString(100, 730, "Rules for window ventilation: The openable area of windows should be at least")
            c.drawString(100, 710, "15% of the floor area in dry hot climates.")
            c.drawString(100, 690, "For effective air flow, cross ventilation is required through openings on")
            c.drawString(100, 670, "opposite walls.")
            c.save()
        except ImportError:
            pass

def extract_structured_rules(text):
    text_lower = text.lower()
    rules = []
    
    # 1. Parse Window Area Percentage
    window_match = re.search(r'(\d{1,3})\s*%', text_lower)
    if window_match and 'area' in text_lower:
        rules.append({
            "type": "window_area",
            "condition": f">= {window_match.group(1)}%",
            "description": "Minimum opening area requirement relative to floor area"
        })
        
    # 2. Parse Cross Ventilation
    if 'cross ventilation' in text_lower or 'opposite wall' in text_lower:
        rules.append({
            "type": "cross_ventilation",
            "condition": "required",
            "description": "Openings must be placed on opposite walls for airflow"
        })

    return rules

def validate_model_against_rules(ifc_path, rules):
    print(f"\nEvaluating IFC Model: {ifc_path}")
    
    if not IFC_AVAILABLE:
         return {"error": "ifcopenshell not installed. Please run pip install ifcopenshell"}

    try:
        model = ifcopenshell.open(ifc_path)
    except Exception as e:
        # Fallback for hackathon demo if file is unavailable or corrupted
        print(f"Failed to load IFC file ({e}). Running on simulated mock model...")
        model = None

    # Determine required minimum from rules
    min_area_ratio = 0.15 # default 15%
    for r in rules:
        if r.get("type") == "window_area":
            try:
                # Remove non-numeric characters to parse float
                val = float(r.get("condition").replace(">=", "").replace("%", "").strip())
                min_area_ratio = val / 100.0
            except ValueError:
                pass

    validation_results = {}

    if model:
        spaces = model.by_type("IfcSpace")
        if not spaces:
             print("No IfcSpace instances found. Proceeding with basic geometric approximations.")
             spaces = ["Simulated_IFC_Space_1", "Simulated_IFC_Space_2"] # Fallback array
    else:
        spaces = ["Bedroom_1", "Living_Room", "Kitchen"]

    for i, space in enumerate(spaces):
        # 1. Extract Room/Space dimensions and floor area
        room_name = getattr(space, "Name", f"Room_{i+1}") if hasattr(space, "is_a") else space
        
        # Gross Floor Area Approximation 
        floor_area = 100.0
        if hasattr(space, "is_a"):
             psets = ifcopenshell.util.element.get_psets(space)
             floor_area = psets.get("BaseQuantities", {}).get("GrossFloorArea", 100.0)
        else:
             # Simulated sizes if model crashed
             floor_area = [120.0, 200.0, 80.0][i % 3]

        # 2. Extract Window Elements inside this room
        # Bounding box collision or IfcRelSpaceBoundary logic takes hundreds of lines, 
        # doing simple hackathon approximation assuming spaces have assigned windows.
        window_area = 0.0
        windows_count = 0

        if hasattr(space, "is_a"):
              # Naive approximation: global windows / number of rooms
              all_windows = model.by_type("IfcWindow")
              windows_count = max(1, len(all_windows) // max(1, len(spaces)))
              
              if windows_count > 0:
                  for w in all_windows[:windows_count]:
                      w_psets = ifcopenshell.util.element.get_psets(w)
                      area = w_psets.get("BaseQuantities", {}).get("Area", 4.0)
                      window_area += area
        else:
              windows_count = [2, 1, 3][i % 3]
              window_area = [25.0, 10.0, 30.0][i % 3]
        
        # 3. Apply Rules Validation
        ratio = window_area / floor_area if floor_area > 0 else 0
        window_check = "PASS" if ratio >= min_area_ratio else "FAIL"
        
        # Basic check: if windows >= 2 we assume they can be on opposite walls (basic approximation)
        cross_vent_check = "PASS" if windows_count >= 2 else "FAIL"

        validation_results[room_name] = {
             "floor_area_sqm": round(floor_area, 2),
             "window_area_sqm": round(window_area, 2),
             "extracted_ratio": f"{(ratio * 100):.1f}%",
             "window_area_check": window_check,
             "cross_ventilation": cross_vent_check
        }

    return validation_results

def main():
    pdf_path = os.path.join("data", "is.3362.1977.pdf")
    build_pdf_if_missing(pdf_path)
    
    print("Loading IS 3362 PDF...")
    loader = PyPDFLoader(pdf_path)
    documents = loader.load()

    print("Chunking document...")
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = text_splitter.split_documents(documents)

    print("Loading Local HuggingFace Embeddings & Building Vector DB...")
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    vectorstore = FAISS.from_documents(chunks, embeddings)

    query = "What are the rules for minimum window area and cross ventilation?"
    print(f"\n[QUERY] {query}\n")

    results = vectorstore.similarity_search(query, k=3)

    combined_raw_text = ""
    for res in results:
        combined_raw_text += res.page_content.strip() + " "
        
    print("=== EXTRACTED RULES (RAG) ===")
    parsed_rules = extract_structured_rules(combined_raw_text)
    print(json.dumps({"rules": parsed_rules}, indent=2))
    
    print("\n" + "="*50)
    print("=== IFC MODEL VALIDATION ENGINE ===")
    
    # Run the validation against our IFC file
    ifc_file_path = os.path.join("..", "sample1.ifc")
    validation_results = validate_model_against_rules(ifc_file_path, parsed_rules)
    
    print("\n--- FINAL COMPLIANCE REPORT ---")
    print(json.dumps(validation_results, indent=4))

if __name__ == "__main__":
    main()
