from langchain.document_loaders import PyPDFLoader

loader = PyPDFLoader("data/is.3362.1977.pdf")

documents = loader.load()

print(documents[0].page_content)