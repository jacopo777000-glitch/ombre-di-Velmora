from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np, cv2, json
ROOT=Path("."); OUT=ROOT/"assets"/"equip"; OUT.mkdir(parents=True,exist_ok=True)
GROUPS={
 "hair":["Capelli_coda_ciuffi.jpg","Capelli_coda_lunga.jpg","Capelli_lunghi.jpg","Capelli_mossi.jpg","Capelli_rasati_lato.jpg","Capelli_rasta.jpg","Capelli_spettinati.jpg","Capelli_trecce.jpg"],
 "armor":["Armatura_arciere.JPG","Armatura_druido.JPG","Armatura_guerriero.JPG","Armatura_mago.JPG"],
 "headgear":["Cappello_mago.JPG","Cappello_punk.JPG","Elmo_drago.JPG","Elmo_leone.JPG"]}
manifest={}
for group,files in GROUPS.items():
 for filename in files:
  src=ROOT/filename
  if not src.exists(): print("SKIP",filename); continue
  im=Image.open(src).convert("RGB"); arr=np.asarray(im); h,w=arr.shape[:2]
  corners=np.concatenate([arr[:h//15,:w//15].reshape(-1,3),arr[:h//15,-w//15:].reshape(-1,3),arr[-h//15:,:w//15].reshape(-1,3),arr[-h//15:,-w//15:].reshape(-1,3)],axis=0)
  bg=np.median(corners,axis=0)
  dist=np.sqrt(((arr.astype(np.float32)-bg)**2).sum(axis=2))
  candidate=(dist<70).astype(np.uint8)
  n,labels=cv2.connectedComponents(candidate,connectivity=8)
  edge=np.concatenate([labels[0,:],labels[-1,:],labels[:,0],labels[:,-1]])
  edge_ids=set(int(v) for v in np.unique(edge) if int(v)>0)
  bgmask=np.isin(labels,list(edge_ids))
  keep=~bgmask
  yy,xx=np.indices((h,w)); rgb=arr.astype(np.int16); r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
  if group=="hair":
   # Source sheets show the white hairstyle on a mannequin; isolate only the
   # neutral/cool hair area, not the mannequin or parchment.
   spread=np.maximum.reduce([r,g,b])-np.minimum.reduce([r,g,b])
   keep &= (xx>=300)&(xx<=660)&(yy<int(h*.40))&(spread<55)&((r-g)<23)&((r-b)<38)
  elif group=="headgear":
   keep &= yy<int(h*.55)
  n2,lab,stats,_=cv2.connectedComponentsWithStats(keep.astype(np.uint8),8)
  clean=np.zeros((h,w),np.uint8)
  for i in range(1,n2):
   if stats[i,cv2.CC_STAT_AREA]>=12: clean[lab==i]=255
  mask=Image.fromarray(clean).filter(ImageFilter.GaussianBlur(0.65))
  bbox=mask.getbbox()
  if not bbox: print("EMPTY",filename); continue
  rgba=im.convert("RGBA"); rgba.putalpha(mask); cropped=rgba.crop(bbox)
  outname=Path(filename).stem+".png"; cropped.save(OUT/outname,optimize=True)
  manifest[filename]={"file":"assets/equip/"+outname,"group":group,"canvasWidth":w,"canvasHeight":h,"x":bbox[0],"y":bbox[1],"width":bbox[2]-bbox[0],"height":bbox[3]-bbox[1]}
  print("DONE",filename,bbox)
(OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("Processed",len(manifest))
