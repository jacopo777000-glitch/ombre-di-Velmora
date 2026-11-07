from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np, cv2, json

ROOT=Path(".")
OUT=ROOT/"assets"/"equip"
OUT.mkdir(parents=True,exist_ok=True)

GROUPS={
 "hair":["Capelli_coda_ciuffi.jpg","Capelli_coda_lunga.jpg","Capelli_lunghi.jpg","Capelli_mossi.jpg","Capelli_rasati_lato.jpg","Capelli_rasta.jpg","Capelli_spettinati.jpg","Capelli_trecce.jpg"],
 "armor":["Armatura_arciere.JPG","Armatura_druido.JPG","Armatura_guerriero.JPG","Armatura_mago.JPG"],
 "headgear":["Cappello_mago.JPG","Cappello_punk.JPG","Elmo_drago.JPG","Elmo_leone.JPG"]
}

def grabcut_crop(rgb, roi, seed):
    x0,y0,x1,y1=roi
    crop=rgb[y0:y1,x0:x1].copy()
    h,w=crop.shape[:2]
    mask=np.zeros((h,w),np.uint8)
    mask[:,:]=cv2.GC_PR_BGD
    # The whole artwork window is possible foreground; the centre of the object is certain foreground.
    mask[2:h-2,2:w-2]=cv2.GC_PR_FGD
    sx0,sy0,sx1,sy1=seed
    mask[sy0:sy1,sx0:sx1]=cv2.GC_FGD
    bgd=np.zeros((1,65),np.float64); fgd=np.zeros((1,65),np.float64)
    cv2.grabCut(crop,mask,None,bgd,fgd,7,cv2.GC_INIT_WITH_MASK)
    alpha=np.where((mask==cv2.GC_FGD)|(mask==cv2.GC_PR_FGD),255,0).astype(np.uint8)
    # Remove pale parchment-colored pixels even when enclosed inside the crop.
    med=np.median(np.concatenate([rgb[:20,:20].reshape(-1,3),rgb[:20,-20:].reshape(-1,3),rgb[-20:,:20].reshape(-1,3),rgb[-20:,-20:].reshape(-1,3)]),axis=0)
    d=np.sqrt(((crop.astype(np.float32)-med)**2).sum(axis=2))
    alpha=np.where(d<28,0,alpha).astype(np.uint8)
    alpha=cv2.morphologyEx(alpha,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
    return crop,alpha,(x0,y0)

manifest={}
for group,files in GROUPS.items():
 for filename in files:
  p=ROOT/filename
  if not p.exists():
   print("MISSING",filename); continue
  im=Image.open(p).convert("RGB")
  rgb=np.asarray(im); h,w=rgb.shape[:2]
  if group=="hair":
   # Only isolate the white/silver hairstyle in the upper head region.
   x0,x1=int(w*.34),int(w*.72); y0,y1=0,int(h*.34)
   crop=rgb[y0:y1,x0:x1]
   r,g,b=[crop[:,:,i].astype(np.int16) for i in range(3)]
   spread=np.maximum.reduce([r,g,b])-np.minimum.reduce([r,g,b])
   # White/silver hair is near-neutral; skin and parchment are warm.
   alpha=((r-g<13)&(r-b<24)&(spread<72)&(np.maximum.reduce([r,g,b])>65)).astype(np.uint8)*255
   alpha=cv2.morphologyEx(alpha,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
   alpha=cv2.morphologyEx(alpha,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
   origin=(x0,y0)
  elif group=="armor":
   # Full outfit, excluding parchment margins while retaining cape/armour silhouette.
   roi=(int(w*.12),int(h*.015),int(w*.96),int(h*.99))
   rw,rh=roi[2]-roi[0],roi[3]-roi[1]
   crop,alpha,origin=grabcut_crop(rgb,roi,(int(rw*.35),int(rh*.22),int(rw*.72),int(rh*.72)))
  else:
   # All four head accessories are drawn near the top of their parchment sheet.
   roi=(int(w*.20),0,int(w*.82),int(h*.52))
   rw,rh=roi[2]-roi[0],roi[3]-roi[1]
   crop,alpha,origin=grabcut_crop(rgb,roi,(int(rw*.30),int(rh*.08),int(rw*.70),int(rh*.35)))
  mask=Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.55))
  bbox=mask.getbbox()
  if not bbox:
   print("EMPTY",filename); continue
  cut=Image.fromarray(crop).convert("RGBA")
  cut.putalpha(mask)
  cut=cut.crop(bbox)
  outname=Path(filename).stem+".png"
  cut.save(OUT/outname,optimize=True)
  ox,oy=origin
  manifest[filename]={"file":"assets/equip/"+outname,"group":group,"x":ox+bbox[0],"y":oy+bbox[1],"width":bbox[2]-bbox[0],"height":bbox[3]-bbox[1],"sourceWidth":w,"sourceHeight":h}
  print("OK",filename,manifest[filename]["x"],manifest[filename]["y"],manifest[filename]["width"],manifest[filename]["height"])
(OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("Processed",len(manifest),"transparent cutouts")
