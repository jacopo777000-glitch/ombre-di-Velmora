from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np
import cv2, json

ROOT=Path(".")
OUT=ROOT/"assets"/"equip"
OUT.mkdir(parents=True,exist_ok=True)

GROUPS={
 "hair":[
  "Capelli_coda_ciuffi.jpg","Capelli_coda_lunga.jpg","Capelli_lunghi.jpg",
  "Capelli_mossi.jpg","Capelli_rasati_lato.jpg","Capelli_rasta.jpg",
  "Capelli_spettinati.jpg","Capelli_trecce.jpg"],
 "armor":["Armatura_arciere.JPG","Armatura_druido.JPG","Armatura_guerriero.JPG","Armatura_mago.JPG"],
 "headgear":["Cappello_mago.JPG","Cappello_punk.JPG","Elmo_drago.JPG","Elmo_leone.JPG"]
}
manifest={}
for group, files in GROUPS.items():
 for filename in files:
  src=ROOT/filename
  if not src.exists():
   print("SKIP missing",filename); continue
  im=Image.open(src).convert("RGB")
  arr=np.asarray(im)
  h,w=arr.shape[:2]
  # Estimate the parchment from the four corners, avoiding the illustrated subject.
  corners=np.concatenate([arr[:max(8,h//18),:max(8,w//18)].reshape(-1,3),
                          arr[:max(8,h//18),-max(8,w//18):].reshape(-1,3),
                          arr[-max(8,h//18):,:max(8,w//18)].reshape(-1,3),
                          arr[-max(8,h//18):,-max(8,w//18):].reshape(-1,3)],axis=0)
  bg=np.median(corners,axis=0)
  dist=np.sqrt(((arr.astype(np.float32)-bg)**2).sum(axis=2))
  # Connected parchment regions are removed; isolated parchment-like highlights inside
  # the artwork remain protected by the edge-connected component test.
  candidate=(dist<46).astype(np.uint8)
  count, labels=cv2.connectedComponents(candidate, connectivity=8)
  edge_ids=set(np.unique(np.concatenate([labels[0,:],labels[-1,:],labels[:,0],labels[:,-1]])).tolist())
  bgmask=np.isin(labels,list(edge_ids))
  keep=~bgmask
  if group=="hair":
   # Hairstyle source sheets contain the mannequin too: keep only the cool/neutral
   # hair pixels in the head area, not the underlying body.
   yy,xx=np.indices((h,w))
   r,g,b=arr[:,:,0],arr[:,:,1],arr[:,:,2]
   hair_colour=((r.astype(int)-g.astype(int)<30)&(r.astype(int)-b.astype(int)<48)&
                (np.maximum.reduce([r,g,b])-np.minimum.reduce([r,g,b])<65))
   keep &= (yy < int(h*0.34)) & hair_colour
  if group=="headgear":
   # Isolated hat/helmet artwork sits in the upper third of the parchment sheet.
   yy,xx=np.indices((h,w))
   keep &= (yy < int(h*0.42))
  # Remove tiny speckles and soften only the cut edge.
  n, lab, stats, _=cv2.connectedComponentsWithStats(keep.astype(np.uint8),8)
  clean=np.zeros((h,w),np.uint8)
  for i in range(1,n):
   if stats[i,cv2.CC_STAT_AREA] >= 18:
    clean[lab==i]=255
  mask=Image.fromarray(clean).filter(ImageFilter.GaussianBlur(0.7))
  bbox=mask.getbbox()
  if not bbox:
   print("SKIP empty",filename); continue
  rgba=im.convert("RGBA")
  rgba.putalpha(mask)
  # Crop to the artwork bounds; bbox is retained so the game can place it at
  # its original coordinates on top of the unchanged base character.
  cropped=rgba.crop(bbox)
  outname=Path(filename).stem+".png"
  cropped.save(OUT/outname,optimize=True)
  manifest[filename]={"file":"assets/equip/"+outname,"group":group,
    "canvasWidth":w,"canvasHeight":h,"x":bbox[0],"y":bbox[1],
    "width":bbox[2]-bbox[0],"height":bbox[3]-bbox[1]}
  print("DONE",filename,bbox)
(OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("Processed",len(manifest),"assets")
