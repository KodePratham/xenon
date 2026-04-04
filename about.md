# Project P-05: Agentic AI Co-Pilot for Structural Engineering Design Review and Code Compliance Check

---

## 1. Problem Statement
[cite_start]Structural engineers spend a disproportionate amount of time manually cross-checking design drawings against multiple **IS/BIS codes**[cite: 134]. [cite_start]This repetitive cognitive task is error-prone and causes significant delays in project approvals[cite: 134].

---

## 2. Problem Description
* [cite_start]**Regulatory Complexity**: Structural design review in India requires simultaneous compliance with various standards, such as **IS 456** (RCC), **IS 800** (Steel), **IS 1893** (Seismic), and **NBC 2016**[cite: 136].
* [cite_start]**Manual Bottlenecks**: Engineers manually parse hundreds of pages of code provisions for every design iteration, a process that is slow and inconsistent[cite: 137].
* [cite_start]**Safety Risks**: Mistakes that escape manual review can result in structural deficiencies only caught during construction or after occupancy[cite: 138].
* [cite_start]**The Opportunity**: An AI agent that understands geometric intent via **IFC parsing** and regulatory text via **RAG** can autonomously flag non-compliances and compress review cycles[cite: 139].

---

## 3. Expected Solution
[cite_start]The goal is to build an agentic AI prototype that accepts an **IFC structural model** and a set of **IS code PDFs** to perform the following[cite: 141]:

* [cite_start]**Data Extraction**: Parse member geometry, material tags, and load case annotations from the IFC file[cite: 142].
* [cite_start]**Automated Reasoning**: Use a **RAG pipeline** to query code documents for relevant clauses[cite: 142].
* [cite_start]**Compliance Reporting**: Output a structured report listing checked elements, applicable clauses, design values, code limits, and pass/fail status[cite: 143].
* [cite_start]**3D Visualisation**: A viewer should colour-code non-compliant members in the model[cite: 144].
* [cite_start]**Agentic Loop (Bonus)**: Propose revised section sizes for failed members and re-check compliance automatically[cite: 145].

---

## 4. Recommended Technology Stack
* [cite_start]**IFC Parsing**: IfcOpenShell (Python)[cite: 147].
* **RAG Pipeline**: LangChain + FAISS or Chroma vector store; [cite_start]PDF ingestion via PDFPlumber or Unstructured.io[cite: 147, 148].
* [cite_start]**LLM**: Claude 3.5 Sonnet or GPT-4o via API for clause interpretation[cite: 149].
* [cite_start]**3D Viewer**: xeokit-sdk (open-source BIM viewer)[cite: 150].
* [cite_start]**Agentic Loop (Bonus)**: LangGraph or CrewAI[cite: 150].
* [cite_start]**Report Generation**: Python-docx or ReportLab[cite: 150].

---

## 5. Key References
* [cite_start]**IfcOpenShell Python API**: [https://ifcopenshell.org/docs/](https://ifcopenshell.org/docs/) [cite: 152]
* [cite_start]**xeokit BIM Viewer SDK**: [https://xeokit.io](https://xeokit.io) [cite: 153]
* [cite_start]**LangChain RAG Documentation**: [https://python.langchain.com/docs/use_cases/question_answering/](https://python.langchain.com/docs/use_cases/question_answering/) [cite: 154]
* [cite_start]**IS 456:2000**: Plain and Reinforced Concrete Code, BIS [cite: 155]