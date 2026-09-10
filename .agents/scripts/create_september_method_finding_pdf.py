import fitz, json, textwrap, pathlib
out = '.local/outputs/september-prayag-variance-method-finding-2026-09-07.pdf'
summary = json.loads(pathlib.Path('/tmp/clamp-summary.json').read_text())

doc = fitz.open()
page = doc.new_page(width=595, height=842)
page.insert_font(fontname='DejaVuSans', fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
page.insert_font(fontname='DejaVuSans-Bold', fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
W, H = page.rect.width, page.rect.height
navy = (0.055, 0.23, 0.27)
ink = (0.10, 0.14, 0.18)
muted = (0.35, 0.40, 0.43)
green = (0.09, 0.42, 0.34)
light_green = (0.91, 0.97, 0.95)
light_blue = (0.93, 0.96, 0.98)
orange = (0.82, 0.51, 0.10)
light_orange = (1.0, 0.96, 0.87)
line = (0.78, 0.83, 0.84)

def rect(x0,y0,x1,y1,color,fill=True,width=0.7):
    r=fitz.Rect(x0,y0,x1,y1); page.draw_rect(r,color=color,fill=color if fill else None,width=width)

def text(x,y,s,size=9,color=ink,bold=False,box=None,align=0):
    font='DejaVuSans-Bold' if bold else 'DejaVuSans'
    if box is None:
        page.insert_text((x,y),s,fontname=font,fontsize=size,color=color)
    else:
        page.insert_textbox(fitz.Rect(*box),s,fontname=font,fontsize=size,color=color,align=align,lineheight=1.25)

def wrap(s,width): return '\n'.join(textwrap.wrap(s,width=width,break_long_words=False))
def num(x): return f'{round(x):,}'

# Header
text(48,42,'PRAYAG INDIA · SEPTEMBER 2026 PTMT METHOD FINDING',9,orange,True)
text(48,74,'Part 2 — a genuine method difference:',20,navy,True)
text(48,99,'colour is a real production constraint',22,navy,True)
text(48,123,'Standalone method note · Fresh PTMT Temporary Plan #2410',9,muted)

# Conclusion callout
rect(48,143,547,222,light_green)
rect(48,143,53,222,green)
text(66,166,'Colour is a real constraint that the code-level view cannot see.',13,navy,True)
text(66,188,wrap('The difference is a useful method finding, not a criticism of either workbook. The two methods answer slightly different questions: Prayag combines colours at code level, while the app keeps each colour separate. An IVORY surplus cannot fill a WHITE order, so the app preserves production for the colours customers actually need.',92),9,ink)

# KPI cards
cards=[
 ('Exact-input review',f"{summary['input_identical_positive_codes']} codes",'current persisted #2410 basis'),
 ('Code-level clamp',num(summary['input_identical_positive_code_level_total']),'comparable to Prayag'),
 ('Colour-level clamp',num(summary['input_identical_positive_colour_level_total']),'app execution basis'),
 ('Production preserved',num(summary['input_identical_positive_benefit_total']),'colour constraint benefit'),
]
y=242
for idx,(label,val,sub) in enumerate(cards):
 x=48+idx*125.0
 rect(x,y,x+116,y+76,light_blue)
 text(x+9,y+20,label,7.5,muted,True)
 text(x+9,y+45,val,14,navy,True)
 text(x+9,y+62,sub,6.5,muted)

# Method table
text(48,350,'The two figures must remain separate',14,navy,True)
text(48,368,wrap('Comparing on the code-level clamp proves the calculation matches. Planning on the colour-level clamp is the improvement. If they’re conflated, the app’s business benefit disappears into a reconciliation variance.',95),9,ink)
rect(48,406,547,432,navy)
headers=[('Measure',48,205),('Meaning',205,430),('September result',430,547)]
for h,x0,x1 in headers:text(x0+7,424,h,8,(1,1,1),True)
rows=[
 ('Code-level clamp','Clamp after code-level aggregation; comparable to Prayag',num(summary['input_identical_positive_code_level_total'])),
 ('Colour-level clamp','Clamp each code-colour need, then sum; app basis',num(summary['input_identical_positive_colour_level_total'])),
 ('App-preserved production','Colour-level clamp minus code-level clamp',num(summary['input_identical_positive_benefit_total'])),
]
ry=449
for i,(a,b,c) in enumerate(rows):
 if i%2==0:rect(48,ry-16,547,ry+18,(0.97,0.98,0.98))
 text(55,ry,a,8,ink,True); text(212,ry,wrap(b,38),7.5,ink); text(437,ry,c,9,green,True); ry+=49

# Illustrative zero-to-positive examples
text(48,591,'Illustrative zero-to-positive cases',14,navy,True)
text(48,609,'The code-level view plans nothing; colour-level planning preserves the shippable colour need.',8,muted)
rect(48,620,547,638,navy)
for x,h in [(55,'Code'),(145,'Code-level clamp'),(270,'Colour-level clamp'),(405,'What the mechanism shows')]:text(x,634,h,7.5,(1,1,1),True)
examples=[('123-O','0','1,156','WHITE need is masked by IVORY surplus'),('121-E','0','1,044','WHITE need is masked by IVORY surplus')]
ry=654
for i,(a,b,c,d) in enumerate(examples):
 if i%2==0:rect(48,ry-13,547,ry+12,(0.97,0.98,0.98))
 text(55,ry,a,8,ink,True);text(145,ry,b,8,ink);text(270,ry,c,8,green,True);text(405,ry,d,7.2,ink);ry+=25
text(48,714,wrap('These are not arithmetic anomalies. They are the direct consequence of treating colour as a real fulfilment constraint: a surplus in one colour cannot fill a different colour’s order.',95),8.5,green,True)

# Basis note / footer
rect(48,744,547,786,light_orange)
text(56,758,wrap('Basis note: the persisted #2410 artifact reproduces 134 exact input-identical positive codes. The comparison CSV carries both clamp columns for audit.',100),6.8,ink)
text(56,0,'The plan will continue to be prepared per colour. Colour-level planning produces about 29,333 more pieces a month than a code-level view — production that is genuinely needed, because a colour surplus cannot fill a different colour’s order.\n\nNothing needs changing in your sheet. The two methods answer slightly different questions; this note simply explains why the app’s figure is higher.',6.8,green,True,box=(56,793,539,838))

doc.set_metadata({'title':'September PTMT variance — colour-level clamp business finding','author':'Prayag India PTMT verification'})
doc.save(out,garbage=4,deflate=True)
print(out)
print('pages',len(doc),'bytes',pathlib.Path(out).stat().st_size)
