import fitz
src='.local/outputs/september-prayag-variance-method-finding-2026-09-07.pdf'
doc=fitz.open(src)
for idx,page in enumerate(doc):
    pix=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False)
    pix.save(f'.agents/outputs/september-method-finding-page-{idx+1}.png')
print('pages',doc.page_count)
