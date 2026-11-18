/* Mines & Megawatts — WV prototype. MapLibre GL JS + OpenFreeMap. No Esri code; look borrowed from ArcGIS dashboards as a design reference. */
(function(){
'use strict';
const PWH='c5eff3e47d0941b8f8cbd9346e3cab595bff54319364ed39662756af33146e5f', SALT='lodeandload-preview:';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const fmt=(n,d=0)=>n==null?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d});
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const A=(u,t)=>`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`;
const isPhone=()=>matchMedia('(max-width:760px)').matches;
const WVGES_MINED='https://atlas.wvgs.wvnet.edu/arcgis/rest/services/Coal_Web_Mercator/All_Mining_WM/MapServer';
const USGS_RELIEF='https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer';
const WVGES_WELLS='https://atlas2.wvgs.wvnet.edu/server/rest/services/OilGas_WVOG/WVOG_Layer/MapServer/4';
const S={dc:null,coal:null,min:null,pp:null,tx:null,alpr:null,ev:null,cty:null,st:null};
let map, county=null, coalYear=null, mineFilter={active:true,idle:true,abandoned:false}, minGroups={copper:true,battery:true,ree:true,other:false};
const wellsLoaded={}, wellRows=[]; let cinfo={};

/* ---------- gate ---------- */
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function unlock(){document.body.classList.remove('locked');const g=$('#gate');if(g)g.remove();start()}
if(PWH==='PUBLIC') setTimeout(unlock,0);
else{document.body.classList.add('locked');
if(sessionStorage.getItem('ll_ok')===PWH) unlock();
else $('#gate-f').addEventListener('submit',async e=>{e.preventDefault();
  const h=await sha(SALT+$('#gate-p').value);
  if(h===PWH){sessionStorage.setItem('ll_ok',PWH);unlock()} else {$('#gate-e').textContent='Wrong password.'}});}

/* ---------- boot ---------- */
async function getJSON(u){const r=await fetch(u);if(!r.ok) throw new Error(u+' '+r.status);return r.json()}
async function start(){
  offlineInit(); initSearchAndView();
  map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/dark',center:[-80.18,38.9],zoom:6.4,minZoom:5,maxZoom:17,attributionControl:false,hash:false});
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'Data credits: tap Sources · © OpenStreetMap contributors (ODbL)'}),'bottom-right');
  map.addControl(new maplibregl.NavigationControl({visualizePitch:false}),'top-right');
  map.addControl(new HomeCtl(),'top-right');
  map.addControl(new maplibregl.GeolocateControl({trackUserLocation:false}),'top-right');
  map.addControl(new maplibregl.ScaleControl({unit:'imperial'}),'bottom-right');
  const [dc,cty,st,ev]=await Promise.all([getJSON('data/datacenters_odbl.geojson'),getJSON('data/counties.geojson'),getJSON('data/stats.json'),getJSON('data/ev_stations.geojson')]);
  S.dc=dc;S.cty=cty;S.st=st;S.ev=ev;
  cty.features.forEach(f=>{const cs=(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).flat(2);
    let a=[180,90,-180,-90];cs.forEach(([x,y])=>{a=[Math.min(a[0],x),Math.min(a[1],y),Math.max(a[2],x),Math.max(a[3],y)]});cinfo[f.properties.name]={bbox:a,fips:f.properties.fips}});
  buildPanel(); renderCards(); renderCharts(); renderLegend();
  map.on('load',()=>{const at=document.querySelector('.maplibregl-ctrl-attrib');if(at&&isPhone())at.classList.remove('maplibregl-compact-show');addEvIcons();addBase();addDC();ensure('coal');ensure('alpr');ensure('ev');applyVis();window.__ready=true;const o=$('#offline');if(o&&navigator.onLine!==false)o.hidden=true;if(/^#us\b/.test(location.hash))setView('us')});
  map.on('error',e=>{const m=String(e&&e.error&&e.error.message||''); if(!window.__ready&&/Failed to fetch|NetworkError|load failed/i.test(m)){const o=$('#offline');if(o)o.hidden=false} if(e&&e.error&&!/tile|Failed to fetch|AbortError|NetworkError/i.test(m)) console.warn('map',m)});
  map.on('click',onClick);
  map.on('moveend',()=>{loadWells(); if(view==='wv') renderCards()});
  addEventListener('resize',()=>{renderCharts()});
}
class HomeCtl{onAdd(m){const d=document.createElement('div');d.className='maplibregl-ctrl maplibregl-ctrl-group home-btn';d.innerHTML='<button type="button" title="Zoom out to the whole view" aria-label="Zoom out to the whole state or country"><svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/></svg></button>';d.onclick=()=>{if(view==='us'){usSelect(null);return} setCounty(null);m.setPadding({top:0,bottom:0,left:0,right:0});m.fitBounds([[-82.65,37.2],[-77.72,40.64]],{padding:pad()})};return d}onRemove(){}}
function pad(){return isPhone()?{top:110,bottom:180,left:20,right:20}:{top:110,bottom:40,left:($('body').classList.contains('nopanel')?20:330),right:220}}

/* ---------- layers ---------- */
const LAY={dc:true,coal:true,lidar:false,mined:false,min:false,wells:false,alpr:false,pp:false,tx:false,ev:false};
function addEvIcons(){
  if(!map||map.hasImage('ev-bolt')) return;
  const mk=(name,bg,draw)=>{
    const c=document.createElement('canvas'); c.width=64; c.height=64; const g=c.getContext('2d');
    g.clearRect(0,0,64,64); draw(g,bg); map.addImage(name,g.getImageData(0,0,64,64),{pixelRatio:2});
  };
  mk('ev-bolt','#123', (g)=>{
    g.fillStyle='#0b1a18'; g.beginPath(); g.moveTo(30,10); g.lineTo(18,36); g.lineTo(29,36); g.lineTo(24,54); g.lineTo(46,28); g.lineTo(34,28); g.lineTo(40,10); g.closePath(); g.fill();
    g.fillStyle='#fff'; g.beginPath(); g.moveTo(31,13); g.lineTo(21,35); g.lineTo(31,35); g.lineTo(27,50); g.lineTo(43,30); g.lineTo(33,30); g.lineTo(38,13); g.closePath(); g.fill();
  });
  mk('ev-plug','#123', (g)=>{
    g.strokeStyle='#0b1a18'; g.fillStyle='#0b1a18'; g.lineWidth=5; g.lineCap='round';
    g.beginPath(); g.moveTo(24,16); g.lineTo(24,28); g.moveTo(40,16); g.lineTo(40,28); g.stroke();
    g.beginPath(); g.roundRect?g.roundRect(16,26,32,22,5):(g.rect(16,26,32,22)); g.fill();
    g.beginPath(); g.moveTo(32,48); g.lineTo(32,56); g.stroke();
    g.strokeStyle='#fff'; g.fillStyle='#fff'; g.lineWidth=3;
    g.beginPath(); g.moveTo(24,17); g.lineTo(24,27); g.moveTo(40,17); g.lineTo(40,27); g.stroke();
    g.fillRect(19,28,26,18);
  });
}
function addBase(){
  map.addSource('cty',{type:'geojson',data:S.cty,promoteId:'fips'});
  const wc=['match',['get','fips']]; S.cty.features.forEach(f=>{wc.push(f.properties.fips,(S.st.county[f.properties.name]||{}).wells||0)}); wc.push(0);
  map.addLayer({id:'cty-wells',type:'fill',source:'cty',maxzoom:9.5,paint:{'fill-color':['interpolate',['linear'],wc,0,'#1d1730',1000,'#3b2a66',4000,'#6a46b0',8000,'#9a6ee0',12000,'#d4b8ff'],'fill-opacity':0.55},layout:{visibility:'none'}});
  map.addLayer({id:'cty-line',type:'line',source:'cty',paint:{'line-color':'#8a8a8a','line-width':['interpolate',['linear'],['zoom'],6,0.4,10,1.2],'line-opacity':0.6}});
  map.addLayer({id:'cty-sel',type:'line',source:'cty',paint:{'line-color':'#3fa9f5','line-width':2.5},filter:['==',['get','fips'],'']});
  // Lidar terrain: USGS 3DEP shaded relief, cached tiles (public domain). Sits just above the basemap land fills, under roads, labels and all data.
  map.addSource('lidar',{type:'raster',tiles:[USGS_RELIEF+'/tile/{z}/{y}/{x}'],tileSize:256,minzoom:5,maxzoom:16,
    attribution:'Elevation: <a href="https://www.usgs.gov/3d-elevation-program" target="_blank">USGS 3D Elevation Program (3DEP)</a>, public domain'});
  const under=map.getStyle().layers.find(l=>l.id==='waterway')?'waterway':undefined;
  map.addLayer({id:'lidar',type:'raster',source:'lidar',paint:{'raster-opacity':lidarOp,'raster-brightness-max':0.5,'raster-contrast':0.45,'raster-saturation':-1,'raster-fade-duration':150},layout:{visibility:'none'}},under);
  map.addSource('mined',{type:'raster',tiles:[WVGES_MINED+'/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:1,2&f=image'],tileSize:256,minzoom:7,
    attribution:'Mined areas: <a href="https://www.wvgs.wvnet.edu/www/coal/cbmp/coalims.html" target="_blank">WV Geological &amp; Economic Survey, Coal Bed Mapping Program</a>'});
  map.addLayer({id:'mined',type:'raster',source:'mined',paint:{'raster-opacity':0.55},layout:{visibility:'none'}});
}
function addDC(){
  map.addSource('dc',{type:'geojson',data:S.dc});
  map.addLayer({id:'dc-halo',type:'circle',source:'dc',paint:{'circle-radius':['interpolate',['linear'],['coalesce',['get','mw'],0],0,9,500,14,2400,26],'circle-color':'#ff6b5a','circle-opacity':0.18}});
  map.addLayer({id:'dc',type:'circle',source:'dc',paint:{'circle-radius':['interpolate',['linear'],['coalesce',['get','mw'],0],0,5,500,8,2400,13],
    'circle-color':['match',['get','status'],'operating','#4cc38a','under_construction','#ffd34d','permitted','#c08cff','#ff6b5a'],'circle-stroke-color':'#111','circle-stroke-width':1.5}});
  map.addLayer({id:'dc-lbl',type:'symbol',source:'dc',minzoom:7,filter:['>',['coalesce',['get','mw'],0],0],layout:{'text-field':['concat',['to-string',['get','mw']],' MW'],'text-font':['Noto Sans Regular'],'text-size':11,'text-offset':[0,1.4],'text-anchor':'top'},paint:{'text-color':'#ffd0c8','text-halo-color':'#000','text-halo-width':1.2}});
}
async function ensure(k){
  if(k==='coal'&&!S.coal){S.coal=await getJSON('data/coal_mines.geojson');
    map.addSource('coal',{type:'geojson',data:S.coal});
    map.addLayer({id:'coal',type:'circle',source:'coal',paint:{'circle-radius':['interpolate',['linear'],['zoom'],6,['match',['get','g'],'active',3.6,2],12,['match',['get','g'],'active',8,5]],
      'circle-color':['match',['get','g'],'active','#f5c242','idle','#b88a2e','#6d6249'],'circle-stroke-color':'#000','circle-stroke-width':0.5,'circle-opacity':['match',['get','g'],'abandoned',0.6,0.95]}},'dc-halo');
    applyMineFilter(); applyVis(); renderCards();}
  if(k==='min'&&!S.min){S.min=await getJSON('data/minerals.geojson');
    map.addSource('min',{type:'geojson',data:S.min});
    map.addLayer({id:'min',type:'circle',source:'min',paint:{'circle-radius':['match',['get','g'],'ree_site',8,4.5],'circle-color':['match',['get','g'],'copper','#e07b39','battery','#2fc4b2','ree','#d65cff','ree_site','#d65cff','#8fa3b8'],'circle-stroke-color':['match',['get','g'],'ree_site','#fff','#000'],'circle-stroke-width':['match',['get','g'],'ree_site',2,0.6]}},'dc-halo');
    applyMinFilter(); applyVis(); renderCards();}
  if(k==='alpr'&&!S.alpr){S.alpr=await getJSON('data/alpr_odbl.geojson');
    map.addSource('alpr',{type:'geojson',data:S.alpr});
    map.addLayer({id:'alpr',type:'circle',source:'alpr',paint:{'circle-radius':['interpolate',['linear'],['zoom'],6,3,13,7],'circle-color':['case',['get','flock'],'#ff4fa3','#ff9ccd'],'circle-stroke-color':'#000','circle-stroke-width':0.8}},'dc-halo');
    applyVis(); renderCards();}
  if(k==='pp'&&!S.pp){S.pp=await getJSON('data/power_plants.geojson');
    map.addSource('pp',{type:'geojson',data:S.pp});
    map.addLayer({id:'pp',type:'circle',source:'pp',paint:{'circle-radius':['interpolate',['linear'],['get','mw'],0,3,500,7,3000,14],'circle-color':['match',['get','fuel'],'coal','#8c6d3f','gas','#5ab0ff','hydro','#3cd0e0','wind','#a0e070','solar','#ffe066','battery','#ff9f43','#999'],'circle-opacity':0.85,'circle-stroke-color':['case',['==',['get','stat'],'planned'],'#fff','#000'],'circle-stroke-width':1}},'dc-halo'); applyVis();}
  if(k==='tx'&&!S.tx){S.tx=await getJSON('data/transmission_odbl.geojson');
    map.addSource('tx',{type:'geojson',data:S.tx});
    map.addLayer({id:'tx',type:'line',source:'tx',paint:{'line-color':['interpolate',['linear'],['get','kv'],69,'#2f5f8a',138,'#3f8fd0',345,'#7cc4ff',765,'#e0f2ff'],'line-width':['interpolate',['linear'],['get','kv'],69,0.6,500,1.8,765,2.6],'line-opacity':0.8}},'cty-sel'); applyVis();}
  if(k==='ev'&&S.ev&&!map.getSource('ev')){
    map.addSource('ev',{type:'geojson',data:S.ev,cluster:true,clusterRadius:44,clusterMaxZoom:12,
      clusterProperties:{dcn:['+',['case',['>',['coalesce',['get','dc'],0],0],1,0]]}});
    map.addLayer({id:'ev-cl',type:'circle',source:'ev',filter:['has','point_count'],paint:{
      'circle-radius':['interpolate',['linear'],['get','point_count'],2,14,20,22,80,30],
      'circle-color':['case',['>',['get','dcn'],0],'#128f78','#2a5ea8'],'circle-opacity':0.88,
      'circle-stroke-color':['case',['>',['get','dcn'],0],'#9ff5e4','#9ec5ff'],'circle-stroke-width':1.4}},'dc-halo');
    map.addLayer({id:'ev-cn',type:'symbol',source:'ev',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Regular'],'text-size':11},paint:{'text-color':'#fff'}});
    map.addLayer({id:'ev-pt',type:'circle',source:'ev',filter:['!',['has','point_count']],paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],6,['case',['==',['get','kind'],'dc'],5.5,4],13,['case',['==',['get','kind'],'dc'],9,7]],
      'circle-color':['match',['get','kind'],'dc','#2ee6c7','l1','#8fb8ff','#4d9fff'],
      'circle-stroke-color':'#0b1a18','circle-stroke-width':1.15}},'dc-halo');
    map.addLayer({id:'ev-ic',type:'symbol',source:'ev',filter:['!',['has','point_count']],minzoom:7.5,
      layout:{'icon-image':['match',['get','kind'],'dc','ev-bolt','ev-plug'],'icon-size':0.42,'icon-allow-overlap':true,'icon-ignore-placement':true}});
    applyVis(); renderCards();}
  if(k==='wells'){if(!map.getSource('wells')){map.addSource('wells',{type:'geojson',data:{type:'FeatureCollection',features:[]},cluster:true,clusterRadius:40,clusterMaxZoom:11});
    map.addLayer({id:'wells-cl',type:'circle',source:'wells',filter:['has','point_count'],minzoom:9.5,paint:{'circle-radius':['interpolate',['linear'],['get','point_count'],10,10,500,20,3000,28],'circle-color':'#7a52c7','circle-opacity':0.8,'circle-stroke-color':'#d4b8ff','circle-stroke-width':1}},'dc-halo');
    map.addLayer({id:'wells-cn',type:'symbol',source:'wells',filter:['has','point_count'],minzoom:9.5,layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Regular'],'text-size':11},paint:{'text-color':'#fff'}});
    map.addLayer({id:'wells-pt',type:'circle',source:'wells',filter:['!',['has','point_count']],minzoom:9.5,paint:{'circle-radius':4,'circle-color':['match',['get','t'],'gas','#b07cff','oil','#3dd68c','og','#4fc3f7','dry','#777','#bbb'],'circle-stroke-color':'#000','circle-stroke-width':0.6}},'dc-halo');}
    applyVis(); loadWells();}
}
function applyVis(){
  const v=(id,on)=>{if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',(on&&view==='wv')?'visible':'none')}; v('cty-line',true); v('cty-sel',true);
  ['dc','dc-halo','dc-lbl'].forEach(i=>v(i,LAY.dc)); v('coal',LAY.coal); v('mined',LAY.mined); v('lidar',LAY.lidar); v('min',LAY.min); v('alpr',LAY.alpr); v('pp',LAY.pp); v('tx',LAY.tx);
  ['ev-cl','ev-cn','ev-pt','ev-ic'].forEach(i=>v(i,LAY.ev));
  ['cty-wells','wells-cl','wells-cn','wells-pt'].forEach(i=>v(i,LAY.wells));
  renderLegend();
}
async function setLayer(k,on){LAY[k]=on; if(on&&!['dc','mined','lidar'].includes(k)) await ensure(k); applyVis(); $$(`input[data-lay="${k}"]`).forEach(i=>i.checked=on); renderCards()}
function applyMineFilter(){if(!map.getLayer('coal'))return; const gs=Object.keys(mineFilter).filter(k=>mineFilter[k]);
  const f=['all',['in',['get','g'],['literal',gs]]]; if(coalYear) f.push(['in','|'+coalYear+'|',['coalesce',['get','yrs'],'']]);
  map.setFilter('coal',f)}
function applyMinFilter(){if(!map.getLayer('min'))return; const gs=Object.keys(minGroups).filter(k=>minGroups[k]); if(minGroups.ree) gs.push('ree_site'); map.setFilter('min',['in',['get','g'],['literal',gs]])}
async function loadWells(){
  if(!LAY.wells||!map||view!=='wv'||map.getZoom()<9.5) return;
  const b=map.getBounds(); const need=Object.entries(cinfo).filter(([n,c])=>!(c.bbox[0]>b.getEast()||c.bbox[2]<b.getWest()||c.bbox[1]>b.getNorth()||c.bbox[3]<b.getSouth())&&!wellsLoaded[c.fips]&&((S.st.county[n]||{}).wells||0)>0);
  if(!need.length) return;
  await Promise.all(need.map(async([n,c])=>{wellsLoaded[c.fips]=1; try{const rows=await getJSON('data/wells/'+c.fips+'.json'); rows.forEach(r=>wellRows.push(r))}catch(e){wellsLoaded[c.fips]=0}}));
  map.getSource('wells').setData({type:'FeatureCollection',features:wellRows.map(r=>({type:'Feature',geometry:{type:'Point',coordinates:[r[0],r[1]]},properties:{api:r[2],t:r[3],s:r[4],y:r[5],op:r[6],fld:r[7]}}))});
}

/* ---------- panel ---------- */
const SECS=[
 {k:'Demand',t:'Data centers',c:'var(--dc)',lay:'dc',body:()=>{
   const top=S.dc.features.filter(f=>f.properties.mw).sort((a,b)=>b.properties.mw-a.properties.mw).slice(0,6);
   const sm=S.dc.summary;
   return sw('dc','Data center sites ('+S.dc.features.length+')')+
   `<p class="note">${sm.n_proposed} proposed, permitted or under construction; ${sm.n_operating} operating. Tap a site for its card and <b>estimated</b> power and water use.</p>
   <ol class="steps">${top.map(f=>`<li><button data-fly="dc:${f.properties.id}">${esc(f.properties.name)}<small>${fmt(f.properties.mw)} MW · ${esc(f.properties.county)} Co. · ${esc(f.properties.status.replace('_',' '))}${f.properties.inTotal?'':' · not in total ⚠'}</small></button></li>`).join('')}</ol>
   <p class="note">Sources: ${A('https://datacentersnearme.org/data','DataCentersNearMe')} (ODbL), ${A('https://datacenterdata.com/data/','DataCenterData')} (CC BY 4.0), ${A('https://publicevidence.org/data/national-data-center-public-records','Public Evidence Project')} (CC BY 4.0, 0 WV records yet), PNNL IM3 sites reach us via OSM in DataCentersNearMe.</p>`}},
 {k:'Supply',t:'Coal',c:'var(--coal)',lay:'coal',body:()=>sw('coal','MSHA coal mines')+
   `<div class="chips">${['active','idle','abandoned'].map(g=>`<button class="chip ${mineFilter[g]?'on':''}" data-mf="${g}">${g==='idle'?'Idle / non-producing':g[0].toUpperCase()+g.slice(1)}</button>`).join('')}</div>`+
   sw('mined','Mined areas (WVGES, live)')+
   `<p class="note">Tap a year on the coal chart to show only mines that produced that year. Mines: ${A('https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA.asp','MSHA Mines data set')} (public domain). Production: ${A('https://www.eia.gov/coal/data.cfm','EIA coal data')} (public domain). Mined areas courtesy of the ${A('https://www.wvgs.wvnet.edu/www/coal/cbmp/coalims.html','West Virginia Geological and Economic Survey, Coal Bed Mapping Program')}.</p>`},
 {k:'Supply',t:'Copper & battery minerals',c:'var(--min)',lay:'min',body:()=>sw('min','USGS mineral sites, WV + neighbors')+
   `<div class="chips">${[['copper','Copper'],['battery','Battery (Li, Ni, Co, graphite, Mn)'],['ree','Rare earths'],['other','Other critical']].map(([g,l])=>`<button class="chip ${minGroups[g]?'on':''}" data-mg="${g}">${l}</button>`).join('')}</div>
   <ol class="steps"><li><button data-fly="ree:0">A34 rare earths from mine drainage<small>Mount Storm · WVU + WVDEP · ⚠ town-level pin</small></button></li><li><button data-fly="ree:1">WVU REE development lab<small>Morgantown · ⚠ town-level pin</small></button></li></ol>
   <p class="note">${A('https://mrdata.usgs.gov/mrds/','USGS MRDS')} (public domain; older, uneven records). WV itself has no MRDS copper sites. ⚠ USGS USMIN critical-mineral deposits not added yet.</p>`},
 {k:'Supply',t:'Oil & gas wells',c:'var(--well)',lay:'wells',body:()=>sw('wells','Wells ('+fmt(S.st.wells_total)+')')+
   `<p class="note">State view: wells per county. Zoom in past county level to see clustered, then individual wells.</p>
   <p class="note">Well points: ${A(WVGES_WELLS,'WVGES oil & gas well layer')} (WVGES, from WVDEP Office of Oil and Gas permits). Credit: ${A('https://dep.wv.gov/oil-and-gas/databaseinfo/Pages/default.aspx','WVDEP Office of Oil and Gas')}. <span class="warn">⚠ No license posted; written reuse terms pending.</span></p>`},
 {k:'Watch',t:'Flock / ALPR cameras',c:'var(--alpr)',lay:'alpr',body:()=>sw('alpr','License-plate cameras (OSM)')+
   `<p class="note">Public camera locations mapped in ${A('https://www.openstreetmap.org/copyright','OpenStreetMap')} (ODbL), the same data ${A('https://deflock.org','DeFlock')} shows. No plate data. OSM snapshot ${esc((S.alpr&&S.alpr.osm_base||'2026-11-15').slice(0,10))}.</p>`},
 {k:'Context',t:'Power grid',c:'var(--grid)',lay:'pp',body:()=>sw('pp','Power plants (EIA-860M, Sep 2026)')+sw('tx','Transmission lines 69 kV+ (OSM)')+
   `<p class="note">Plants: ${A('https://www.eia.gov/electricity/data/eia860m/','EIA-860M')} (public domain). Lines: © OpenStreetMap contributors (ODbL), as on ${A('https://openinframap.org/copyright','Open Infrastructure Map')}.</p>`},
];
SECS.push({k:'Context',t:'EV charging',c:'var(--ev)',lay:'ev',body:()=>{
  const sm=S.ev&&S.ev.summary;
  return sw('ev','Public EV charging stations'+(sm?' ('+fmt(sm.n)+')':''))+
  `<p class="note">Public, currently available West Virginia stations from the ${A('https://afdc.energy.gov/stations/','U.S. DOE Alternative Fuels Data Center')}. Teal pins with a lightning bolt are <b>DC fast</b>; blue pins with a plug are <b>Level 2</b>. Dense areas cluster until you zoom in.${sm?` ${fmt(sm.n)} stations, ${fmt(sm.ports)} ports (${fmt(sm.dc)} DC fast, ${fmt(sm.l2)} Level 2). Pulled ${esc(sm.pulled)}.`:''}</p>
   <p class="note">Source: ${A('https://afdc.energy.gov/stations/','U.S. DOE Alternative Fuels Data Center')} (US public domain), via the NREL Alternative Fuel Stations API.</p>`}});
SECS.push({k:'Context',t:'Terrain',c:'var(--terrain)',lay:'lidar',body:()=>sw('lidar','Lidar terrain (USGS 3DEP)')+
   `<label class="rng">Opacity <input type="range" id="lidar-op" min="0.1" max="1" step="0.05" value="${lidarOp}" aria-label="Lidar terrain opacity"> <output id="lidar-op-v">${Math.round(lidarOp*100)}%</output></label>
   <p class="note">Shaded relief from bare-earth elevation, blended softly under the map so ridges, hollows and strip-mine benches show. Zoom in near Logan or Boone County with Coal on. Elevation: ${A('https://www.usgs.gov/3d-elevation-program','USGS 3D Elevation Program (3DEP)')}, public domain; tiles from ${A('https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer','The National Map shaded relief service')}. <span class="warn">⚠ Cached tiles stop at zoom 16 and are drawn from the 3DEP seamless elevation, so they are smoother than raw 1 m lidar.</span></p>`});
let lidarOp=0.45;
function sw(k,label){return `<label class="sw"><input type="checkbox" data-lay="${k}" ${LAY[k]?'checked':''}> ${esc(label)}</label>`}
function buildPanel(){
  $('#sections').innerHTML=SECS.map((s,i)=>`<div class="sec ${i===0?'open':''}" data-i="${i}"><button class="sec-h" aria-expanded="${i===0}"><span class="dot" style="background:${s.c}"></span><span><span class="k">${s.k}</span><span class="t">${s.t}</span></span><span></span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button><div class="sec-b">${s.body()}</div></div>`).join('')+
   `<div class="sec"><div class="sec-b" style="display:block"><p class="note">Mines &amp; Megawatts (formerly Lode &amp; Load). Private prototype, Nov 16, 2026. ${A('#','Sources & method')}</p></div></div>`;
  $$('.sec-h').forEach(b=>b.onclick=()=>{const s=b.parentElement, i=+s.dataset.i, o=!s.classList.contains('open'); s.classList.toggle('open',o); b.setAttribute('aria-expanded',o); if(o) setTimeout(()=>s.scrollIntoView({block:'start',behavior:'auto'}),0); if(o&&SECS[i].lay&&!LAY[SECS[i].lay]) setLayer(SECS[i].lay,true)});
  $('#sections').addEventListener('input',e=>{if(e.target.id==='lidar-op'){lidarOp=+e.target.value; $('#lidar-op-v').textContent=Math.round(lidarOp*100)+'%'; if(map&&map.getLayer('lidar')) map.setPaintProperty('lidar','raster-opacity',lidarOp)}});
  $('#sections').addEventListener('change',e=>{const k=e.target.dataset.lay; if(k) setLayer(k,e.target.checked)});
  $('#sections').addEventListener('click',e=>{const t=e.target.closest('button,a'); if(!t)return;
    if(t.dataset.mf){mineFilter[t.dataset.mf]=!mineFilter[t.dataset.mf];t.classList.toggle('on');applyMineFilter();renderCards()}
    if(t.dataset.mg){minGroups[t.dataset.mg]=!minGroups[t.dataset.mg];t.classList.toggle('on');applyMinFilter();renderCards()}
    if(t.dataset.fly) fly(t.dataset.fly);
    if(t.tagName==='A'&&t.getAttribute('href')==='#'){e.preventDefault();about()}});
  $('#btn-panel').onclick=()=>{const n=document.body.classList.toggle('nopanel');$('#btn-panel').setAttribute('aria-expanded',!n)};
  $('#btn-about').onclick=about;
  $('#panel-handle').onclick=()=>{$('#panel').classList.toggle('full');sheetVar()};
  $$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>{x.classList.toggle('on',x===t);x.setAttribute('aria-selected',x===t)});$$('.tabpane').forEach(p=>p.classList.toggle('on',p.dataset.pane===t.dataset.tab));if(!$('#panel').classList.contains('full')){$('#panel').classList.add('full');sheetVar()}renderCharts()});
  $('#legend-h').onclick=()=>{const o=$('#legend').classList.toggle('open');$('#legend-h').setAttribute('aria-expanded',o)};
  if(!isPhone()) $('#legend').classList.add('open');
  sheetVar();
}
function sheetVar(){document.documentElement.style.setProperty('--sheet',$('#panel').classList.contains('full')?'68vh':'160px')}
async function fly(ref){
  const [k,id]=ref.split(':');
  if(k==='dc'){const f=S.dc.features.find(f=>f.properties.id===id); if(!LAY.dc) await setLayer('dc',true); map.flyTo({center:f.geometry.coordinates,zoom:10,padding:pad()}); showDetail('dc',f.properties,f.geometry.coordinates); $$('[data-fly]').forEach(b=>b.classList.toggle('on',b.dataset.fly===ref))}
  if(k==='ree'){await setLayer('min',true); const f=S.min.features.filter(f=>f.properties.g==='ree_site')[+id]; map.flyTo({center:f.geometry.coordinates,zoom:10,padding:pad()}); showDetail('min',f.properties,f.geometry.coordinates)}
  if(isPhone()){$('#panel').classList.remove('full');sheetVar()}
}

/* ---------- indicator cards ---------- */
function inCounty(f){if(!county)return true; return f.properties.county===county}
function ptIn(c,f){if(!county)return true; const b=cinfo[county].bbox,[x,y]=f.geometry.coordinates; if(x<b[0]||x>b[2]||y<b[1]||y>b[3])return false; return pointInCounty(x,y)}
function pointInCounty(x,y){const g=S.cty.features.find(f=>f.properties.name===county).geometry; const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  return polys.some(p=>{const r=p[0];let ins=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const[xi,yi]=r[i],[xj,yj]=r[j];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))ins=!ins}return ins})}
function evScope(){
  if(!S.ev) return null;
  const all=S.ev.features; let list, scope;
  if(county){ list=all.filter(f=>f.properties.county===county); scope=county+' County'; }
  else if(map){
    const b=map.getBounds();
    list=all.filter(f=>{const[x,y]=f.geometry.coordinates; return x>=b.getWest()&&x<=b.getEast()&&y>=b.getSouth()&&y<=b.getNorth()});
    const sm=S.ev.summary||{}; scope=(list.length===all.length||list.length===(sm.n||all.length))?'West Virginia':'in view';
  } else { list=all; scope='West Virginia'; }
  return {n:list.length, ports:list.reduce((a,f)=>a+(f.properties.ports||0),0), dcn:list.filter(f=>f.properties.kind==='dc').length, scope};
}
function renderCards(){
  if(view==='us') return renderUSCards();
  if(!S.dc) return; const sm=S.dc.summary, cs=county?S.st.county[county]:null;
  const dcs=S.dc.features.filter(inCounty), mw=dcs.reduce((a,f)=>a+(f.properties.inTotal?f.properties.mw:0),0);
  const cost=mw*1000*8760*0.5*sm.method.rate_usd_kwh;
  const mines=S.coal?S.coal.features.filter(f=>(!county||f.properties.county===county)):null;
  const act=mines?mines.filter(f=>f.properties.g==='active').length:null;
  const wells=county?(cs.wells||0):S.st.wells_total;
  const alpr=S.alpr?S.alpr.features.filter(f=>ptIn(county,f)):null;
  const mins=county?cs.min:Object.values(S.st.county).reduce((a,c)=>a+(c.min||0),0);
  const ev=evScope();
  const C=(c,l,v,s)=>`<div class="card" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('#cards').innerHTML=
   C('var(--dc)','Data center MW (stated)',fmt(mw)+' <small>MW</small>',county?`${dcs.length} site${dcs.length===1?'':'s'} · ${A('https://datacenterdata.com/data/','src')}`:`${fmt(mw/sm.wv_capacity_mw*100)}% of WV capacity ⚠ · ${A(sm.wv_cap_url,'EIA')}`)+
   C('var(--warn)','Est. annual power cost<span class="est">estimate</span>','$'+(cost>=1e9?fmt(cost/1e9,2)+'<small>B</small>':fmt(cost/1e6)+'<small>M</small>'),`at 8.34¢/kWh, 50% load · ${A(sm.method.rate_url,'rate')} · ${A('#method','method')}`)+
   C('var(--coal)','Coal mines (MSHA)',act==null?'…':fmt(act)+' <small>active</small>',mines?`${fmt(mines.length)} on record · ${A('https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA.asp','MSHA')}`:'loading')+
   C('var(--well)','Oil & gas wells',fmt(wells),`WVGES well layer ⚠ terms pending · ${A(WVGES_WELLS,'src')}`)+
   C('var(--alpr)','Flock cameras',alpr?fmt(alpr.filter(f=>f.properties.flock).length):'…',alpr?`${fmt(alpr.length)} ALPR total · ${A('https://www.openstreetmap.org/copyright','OSM')} ODbL`:'loading')+
   C('var(--min)','Critical-mineral sites (WV)',mins==null?'…':fmt(mins),`USGS MRDS · ${A('https://mrdata.usgs.gov/mrds/','src')}`)+
   C('var(--ev)','EV charging',ev?fmt(ev.ports)+' <small>ports</small>':'…',ev?`${fmt(ev.n)} station${ev.n===1?'':'s'} · ${fmt(ev.dcn)} DC fast · ${esc(ev.scope)} · ${A('https://afdc.energy.gov/stations/','DOE AFDC')}`:'loading');
  $$('#cards a[href="#method"]').forEach(a=>a.onclick=e=>{e.preventDefault();about()});
  $('#scope').classList.toggle('on',!!county); $('#scope').innerHTML=county?`<button aria-label="Clear county">${esc(county)} County ✕</button>`:'';
  if(county) $('#scope button').onclick=()=>setCounty(null);
}

/* ---------- charts (Water-Balance style: click a year to filter the map) ---------- */
function barChart(data,{h=90,sel=null,fmtv=v=>fmt(v),onPick=null,color=null}={}){
  const W=340,P=22,keys=Object.keys(data),vals=keys.map(k=>data[k]),mx=Math.max(1,...vals),bw=(W-P)/keys.length;
  const bars=keys.map((k,i)=>{const bh=(vals[i]/mx)*(h-24);return `<rect class="bar ${String(sel)===k?'sel':''}" data-k="${k}" x="${P+i*bw+1}" y="${h-14-bh}" width="${Math.max(1,bw-2)}" height="${bh}"${color?` style="fill:${color}"`:''}><title>${k}: ${fmtv(vals[i])}</title></rect>`}).join('');
  const st=Math.ceil(keys.length/6);const lab=keys.map((k,i)=>(i===keys.length-1||(i%st===0&&keys.length-1-i>=st/2+0.5))?`<text x="${P+i*bw+bw/2}" y="${h-2}" text-anchor="middle">${k.length>4?k.slice(2):k}</text>`:'').join('');
  return `<svg viewBox="0 0 ${W} ${h}" role="img">${bars}${lab}<text x="0" y="10">${fmtv(mx)}</text></svg>`;
}
function renderCharts(){
  if(view==='us') return renderUSCharts();
  if(!S.st) return; const st=S.st, sm=S.dc.summary;
  const coal=county?(st.coal_county[county]||{}):st.coal_state;
  const wd=county?(st.wells_dec[county]||{}):st.wells_dec_state;
  const capPct=Math.min(100,sm.total_mw/sm.wv_capacity_mw*100);
  const html=`<h3>${county?esc(county)+' County':'West Virginia'}</h3>
  <div class="ch"><div class="cap">Coal production, million short tons (EIA, selected years)${coalYear?` · showing mines that produced in <b>${coalYear}</b> <a href="#" data-clr="1">clear</a>`:' · tap a year'}</div>${Object.keys(coal).length?barChart(Object.fromEntries(Object.entries(coal).map(([k,v])=>[k,v/1e6])),{sel:coalYear,fmtv:v=>fmt(v,1),onPick:1,color:null}):'<p class="note">No reported coal production in these years.</p>'}<div class="cap">${A(st.src.coal,'EIA Historical Coal Production Data')} (public domain)</div></div>
  <div class="ch"><div class="cap">Oil & gas wells by completion decade (WVGES ⚠)</div>${Object.keys(wd).length?barChart(wd,{color:'#9a6ee0',h:70}):'<p class="note">No wells on record.</p>'}<div class="cap">${A(st.src.wells,'WVGES well layer')}</div></div>
  ${county?'':`<div class="ch"><div class="cap">Stated data center MW vs WV generating capacity ⚠</div>
   <svg viewBox="0 0 340 44"><rect x="0" y="4" width="340" height="14" fill="#333"/><rect x="0" y="4" width="${340*capPct/100}" height="14" fill="#ff6b5a"/><text x="0" y="32">${fmt(sm.total_mw)} MW proposed (de-duplicated) vs ${fmt(sm.wv_capacity_mw)} MW capacity, 2024 = ${fmt(capPct)}%</text></svg>
   <div class="cap">Capacity: ${A(sm.wv_cap_url,'EIA WV electricity profile 2024')}. Directory MW are source-reported and may overlap.</div></div>`}`;
  const tgt=isPhone()?$('#charts-m'):$('#charts'); (isPhone()?$('#charts'):$('#charts-m')).innerHTML=''; tgt.innerHTML=html;
  tgt.querySelectorAll('.ch:first-of-type rect.bar').forEach(r=>r.onclick=async()=>{coalYear=coalYear===r.dataset.k?null:r.dataset.k; if(!LAY.coal) await setLayer('coal',true); applyMineFilter(); renderCharts()});
  const c=tgt.querySelector('[data-clr]'); if(c) c.onclick=e=>{e.preventDefault();coalYear=null;applyMineFilter();renderCharts()};
}
function renderLegend(){
  if(view==='us') return renderUSLegend();
  const L=[];
  if(LAY.dc) L.push('<div class="lgt">Data centers</div>'+[['#ff6b5a','Proposed'],['#c08cff','Permitted'],['#ffd34d','Under construction'],['#4cc38a','Operating']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join('')+'<div class="note">Size = stated MW</div>');
  if(LAY.coal) L.push('<div class="lgt">Coal mines</div>'+[['#f5c242','Active'],['#b88a2e','Idle'],['#6d6249','Abandoned']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join(''));
  if(LAY.lidar) L.push('<div class="lg"><i class="sq" style="background:linear-gradient(135deg,#d8d8d8,#3a3a3a)"></i>Lidar terrain (USGS 3DEP)</div>');
  if(LAY.mined) L.push('<div class="lg"><i class="sq" style="background:#7a6a50"></i>Mined areas (WVGES)</div>');
  if(LAY.min) L.push('<div class="lgt">Minerals</div>'+[['#e07b39','Copper'],['#2fc4b2','Battery'],['#d65cff','Rare earths'],['#8fa3b8','Other critical']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join(''));
  if(LAY.wells) L.push('<div class="lgt">Wells</div><div class="lg"><i class="sq" style="background:linear-gradient(90deg,#1d1730,#d4b8ff)"></i>Wells per county</div>'+[['#b07cff','Gas'],['#3dd68c','Oil'],['#4fc3f7','Oil & gas'],['#777','Dry']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join(''));
  if(LAY.alpr) L.push('<div class="lgt">ALPR cameras</div><div class="lg"><i style="background:#ff4fa3"></i>Flock Safety</div><div class="lg"><i style="background:#ff9ccd"></i>Other / unknown</div>');
  if(LAY.pp) L.push('<div class="lgt">Power plants</div>'+[['#8c6d3f','Coal'],['#5ab0ff','Gas'],['#3cd0e0','Hydro'],['#a0e070','Wind'],['#ffe066','Solar']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join(''));
  if(LAY.ev) L.push('<div class="lgt">EV charging</div><div class="lg"><i class="ev-dc"></i>DC fast</div><div class="lg"><i class="ev-l2"></i>Level 2</div><div class="note">Clusters expand on zoom or tap</div>');
  if(LAY.tx) L.push('<div class="lg"><i class="ln" style="background:#7cc4ff"></i>Transmission (kV)</div>');
  $('#legend-b').innerHTML=L.join('')||'<div class="note">No layers on</div>';
}

/* ---------- click: feature card, else county ---------- */
function onClick(e){
  if(view==='us') return onClickUS(e);
  const ids=['dc','ev-pt','ev-cl','min','alpr','pp','coal','wells-pt','wells-cl','tx'].filter(i=>map.getLayer(i)&&map.getLayoutProperty(i,'visibility')!=='none');
  const fs=map.queryRenderedFeatures([[e.point.x-6,e.point.y-6],[e.point.x+6,e.point.y+6]],{layers:ids});
  if(fs.length){const f=fs[0],id=f.layer.id;
    if(id==='wells-cl'){map.getSource('wells').getClusterExpansionZoom(f.properties.cluster_id).then(z=>map.easeTo({center:f.geometry.coordinates,zoom:z}));return}
    if(id==='ev-cl'){map.getSource('ev').getClusterExpansionZoom(f.properties.cluster_id).then(z=>map.easeTo({center:f.geometry.coordinates,zoom:Math.min(z+0.2,14)}));return}
    let p=f.properties; if(id==='dc') p=S.dc.features.find(x=>x.properties.id===p.id).properties;
    if(id==='min'&&p.g==='ree_site') p=S.min.features.find(x=>x.properties.name===p.name).properties;
    showDetail(id,p,f.geometry.type==='Point'?f.geometry.coordinates:[e.lngLat.lng,e.lngLat.lat]); return}
  const c=map.queryRenderedFeatures(e.point,{layers:['cty-line','cty-wells'].filter(i=>map.getLayer(i))});
  let n=null; for(const [name,ci] of Object.entries(cinfo)){const b=ci.bbox,{lng,lat}=e.lngLat; if(lng>=b[0]&&lng<=b[2]&&lat>=b[1]&&lat<=b[3]){const save=county;county=name;const hit=pointInCounty(lng,lat);county=save;if(hit){n=name;break}}}
  setCounty(n===county?null:n);
}
function setCounty(n,fit){county=n; if(n&&fit){const b=cinfo[n].bbox;map.setPadding({top:0,bottom:0,left:0,right:0});map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:pad(),maxZoom:10})} if(map.getLayer('cty-sel')) map.setFilter('cty-sel',['==',['get','fips'],n?cinfo[n].fips:'']); renderCards(); renderCharts();
  if(n&&isPhone()){ $$('.tab').find(t=>t.dataset.tab==='charts').click() } }
function showDetail(kind,p,ll){
  const d=$('#detail'); let h='';
  const kv=rows=>'<dl class="kv">'+rows.filter(r=>r[1]!=null&&r[1]!=='').map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')+'</dl>';
  if(kind==='dc'){const m=S.dc.summary.method, e=p.est;
    h=`<div class="kicker">Data center</div><h2>${esc(p.name)}</h2><span class="pill ${p.status}">${esc(p.status.replace('_',' '))}</span>
    ${kv([['Owner / developer',esc(p.owner||'Not stated ⚠')],['County',esc(p.county)],['Utility area',esc(p.utility||'—')],['Stated size',p.mw?`<b>${fmt(p.mw,p.mw%1?1:0)} MW</b> <span class="note">(${esc(p.mwBasis)})</span>`:'Not stated'],['Location',`${esc(p.loc)} · ${A(p.locUrl,'source')}`]])}
    ${e?`<div class="estbox"><div class="h">Estimate · not a reported figure</div>
      <div class="big">≈ $${fmt(e.cost_musd)}M / yr power</div>
      <div>≈ ${fmt(e.twh,2)} TWh / yr electricity · ${fmt(e.share_sales_pct,1)}% of WV 2024 retail sales</div>
      <div>≈ ${fmt(e.water_mgal)} million gal / yr on-site water</div>
      <div class="m">Method: ${fmt(p.mw,p.mw%1?1:0)} MW × 8,760 h × ${m.load_factor*100}% load = kWh; × ${(m.rate_usd_kwh*100).toFixed(2)}¢/kWh (${A(m.rate_url,'EIA WV industrial avg, Aug 2026')}); water × ${m.wue_l_kwh} L/kWh (${A(m.lbnl_url,'LBNL 2024 US avg site WUE')}). Big users negotiate their own rates ⚠; evaporative cooling uses more water.</div></div>`:'<p class="note">No stated MW, so no estimate.</p>'}
    ${p.real&&p.real.length?`<h3>From filings and records</h3><ul class="srcs">${p.real.map(r=>`<li>${esc(r.label)}: <b>${esc(r.value)}</b> · ${A(r.url,'link')}</li>`).join('')}</ul>`:''}
    ${p.flags&&p.flags.length?`<ul class="flags">${p.flags.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>`:''}
    <h3>Sources</h3><ul class="srcs">${p.src.map(s=>`<li>${A(s.url,s.label)} · ${esc(s.license)} · ${esc(s.date||'')}</li>`).join('')}</ul>`}
  else if(kind==='coal'){let ps={}; try{ps=typeof p.ps==='string'?JSON.parse(p.ps):(p.ps||{})}catch(e){}
    h=`<div class="kicker">Coal mine · MSHA ${esc(p.id)}</div><h2>${esc(p.name)}</h2>${kv([['Status',esc(p.status)+(p.sd?` (since ${esc(p.sd)})`:'')],['Type',esc(p.type)],['Operator',esc(p.op)],['County',esc(p.county)],['Employees',p.emp?esc(p.emp):null],['Latest production',p.py?`<b>${fmt(p.pt)}</b> short tons (${p.py})`:'None reported in EIA years used']])}
    ${Object.keys(ps).length?`<div class="ch"><div class="cap">Production by year, short tons</div>${barChart(ps,{h:70,color:'#f5c242'})}</div>`:''}
    <h3>Sources</h3><ul class="srcs"><li>${A('https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA.asp','MSHA Mines data set')} (public domain); look up ID ${esc(p.id)} in ${A('https://www.msha.gov/data-and-reports/mine-data-retrieval-system','MSHA Mine Data Retrieval')}</li><li>${A('https://www.eia.gov/coal/data.cfm','EIA Historical Coal Production Data')} (public domain)</li></ul><p class="note">MSHA coordinates are operator-reported ⚠.</p>`}
  else if(kind==='min'){ if(p.g==='ree_site'){const src=typeof p.src==='string'?JSON.parse(p.src):p.src;
      h=`<div class="kicker">Coal-waste rare earths</div><h2>${esc(p.name)}</h2>${kv([['Place',esc(p.place)],['Location',`${esc(p.loc)} · ${A(p.locUrl,'OSM')}`]])}<p>${esc(p.detail)}</p><h3>Sources</h3><ul class="srcs">${src.map(s=>`<li>${A(s.url,s.label)}</li>`).join('')}</ul>`}
    else h=`<div class="kicker">Mineral site · USGS MRDS</div><h2>${esc(p.name)}</h2>${kv([['Commodities',esc(p.com)],['Status',esc(p.status)],['State / county',esc(p.state)+(p.county?' · '+esc(p.county):'')]])}<h3>Source</h3><ul class="srcs"><li>${A(p.url,'USGS MRDS record '+p.id)} (public domain)</li></ul><p class="note">MRDS is a legacy database; status and location can be dated ⚠.</p>`}
  else if(kind==='wells-pt'){const T={gas:'Gas',oil:'Oil',og:'Oil and gas',dry:'Dry hole',other:'Other / not recorded'};
    h=`<div class="kicker">Oil / gas well · API ${esc(p.api)}</div><h2>${esc(T[p.t]||p.t)} well</h2>${kv([['Status',p.s==='P'?'Permitted':'Completed'],['Completed',p.y||'—'],['Operator at completion',esc((p.op||'').replace(/-{3,}/g,'').trim()||'—')],['Field',esc(p.fld||'—')]])}
    <h3>Sources</h3><ul class="srcs"><li>${A(WVGES_WELLS+'/query?where=api%3D'+encodeURIComponent(p.api)+'&outFields=*&f=html','WVGES well record (API '+p.api+')')}</li><li>Permits: ${A('https://dep.wv.gov/oil-and-gas/databaseinfo/Pages/default.aspx','WVDEP Office of Oil and Gas')}</li></ul><p class="note warn">⚠ No license posted by WVDEP/WVGES; written reuse terms pending.</p>`}
  else if(kind==='alpr') h=`<div class="kicker">License-plate camera (ALPR)</div><h2>${esc(p.mf||'Unknown maker')}</h2>${kv([['Operator',esc(p.op||'Not tagged')]])}<h3>Source</h3><ul class="srcs"><li>${A('https://www.openstreetmap.org/'+p.osm,'OpenStreetMap '+p.osm)} · © OpenStreetMap contributors, ODbL</li><li>Also on ${A('https://deflock.org','DeFlock')}</li></ul><p class="note">Location only. No plate data.</p>`;
  else if(kind==='pp') h=`<div class="kicker">Power plant · EIA ${esc(p.id)}</div><h2>${esc(p.name)}</h2>${kv([['Status',esc(p.stat)],['Nameplate',`<b>${fmt(p.mw,p.mw%1?1:0)} MW</b>`],['Main fuel',esc(p.fuel)+' ('+esc(p.code)+')'],['Owner',esc(p.owner)],['County',esc(p.county)]])}<h3>Source</h3><ul class="srcs"><li>${A('https://www.eia.gov/electricity/data/browser/#/plant/'+p.id,'EIA plant '+p.id)} · ${A('https://www.eia.gov/electricity/data/eia860m/','EIA-860M Sep 2026')} (public domain)</li></ul>`;
  else if(kind==='ev-pt'||kind==='ev'){const kindL=p.kind==='dc'?'DC fast':(p.kind==='l1'?'Level 1':'Level 2');
    const ports=[[ 'Level 2 ports', p.l2?fmt(p.l2):null],['DC fast ports', p.dc?fmt(p.dc):null],['Level 1 ports', p.l1?fmt(p.l1):null]].filter(r=>r[1]);
    h=`<div class="kicker">EV charging · ${esc(kindL)}</div><h2>${esc(p.name)}</h2>
    ${kv([['Address',esc(p.address||'')],['County',esc(p.county||'')],['Network',p.neturl?A(p.neturl,p.network||'—'):esc(p.network||'—')],['Connectors',esc(p.connectors||'—')],...ports,['Hours',esc(p.hours||'Not listed')],['Access',esc(p.access||'Public')],['Pricing',p.pricing?esc(p.pricing):null],['Phone',p.phone?esc(p.phone):null]])}
    <h3>Source</h3><ul class="srcs"><li>${A(p.url||'https://afdc.energy.gov/stations/','U.S. DOE Alternative Fuels Data Center')} (US public domain)${p.confirmed?' · last confirmed '+esc(p.confirmed):''}</li></ul>`;}
  else if(kind==='tx') h=`<div class="kicker">Transmission line</div><h2>${esc(p.kv)} kV</h2>${kv([['Operator',esc(p.op||'Not tagged')]])}<h3>Source</h3><ul class="srcs"><li>${A('https://www.openstreetmap.org/way/'+p.osm,'OSM way '+p.osm)} · ODbL</li></ul>`;
  d.innerHTML=`<button class="iconbtn x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`+h+`<p class="note">Not for engineering, legal, or investment decisions.</p>`;
  d.hidden=false; d.scrollTop=0; d.querySelector('.x').onclick=()=>{d.hidden=true};
  d.querySelectorAll('.ch rect.bar').forEach(r=>r.onclick=null);
}
addEventListener('keydown',e=>{if(e.key==='Escape'){$('#detail').hidden=true;$('#about').hidden=true}});

/* ---------- about / sources ---------- */
function about(){
  const sm=S.dc.summary,m=sm.method;
  $('#about').innerHTML=`<div class="in"><button class="iconbtn x" style="position:absolute;right:8px;top:8px" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  <h2 style="margin-top:0">Sources, licenses and method</h2>
  <p><b>For information only. Not for engineering, legal, or investment decisions.</b> ⚠ marks anything unverified. Mines &amp; Megawatts (formerly Lode &amp; Load).</p>
  <h3>Data center cost estimate</h3><p>Annual kWh = stated MW × 1,000 × 8,760 h × ${m.load_factor*100}% load. Power cost = kWh × ${(m.rate_usd_kwh*100).toFixed(2)}¢ (${A(m.rate_url,'EIA Electric Power Monthly Table 5.6.A, WV industrial, Aug 2026')}). On-site water = kWh × ${m.wue_l_kwh} L/kWh (${A(m.lbnl_url,'LBNL 2024 report')}). Real filed figures (e.g. the Ridgeline air permit) are shown first on each card. De-duplicated stated total: ${fmt(sm.total_mw,1)} MW ≈ $${fmt(sm.est.cost_musd)}M/yr ≈ ${fmt(sm.est.twh,1)} TWh (${fmt(sm.est.share_sales_pct)}% of WV 2024 retail sales of ${sm.wv_sales_twh} TWh).</p>
  <table><tr><th>Layer</th><th>Source</th><th>License</th></tr>
  <tr><td>Data centers</td><td>${A('https://datacentersnearme.org/data','DataCentersNearMe')}; ${A('https://datacenterdata.com/data/','DataCenterData')}; ${A('https://publicevidence.org/data/national-data-center-public-records','Public Evidence Project')} (0 WV records); ${A('https://im3.pnnl.gov/datacenter-atlas','PNNL IM3')} via OSM; WVDEP air permit R13-3713</td><td>ODbL 1.0 / CC BY 4.0 — kept in its own file (datacenters_odbl.geojson)</td></tr>
  <tr><td>Coal mines</td><td>${A('https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA.asp','MSHA Mines data set')}; ${A('https://www.eia.gov/coal/data.cfm','EIA coal production')}</td><td>US public domain</td></tr>
  <tr><td>Mined areas</td><td>${A('https://www.wvgs.wvnet.edu/www/coal/cbmp/coalims.html','West Virginia Geological and Economic Survey, Coal Bed Mapping Program')} (live map service) · ${A('https://www.wvgs.wvnet.edu/','WVGES')}</td><td>Public data; cite WVGES ⚠ written terms pending</td></tr>
  <tr><td>Lidar terrain</td><td>Elevation: ${A('https://www.usgs.gov/3d-elevation-program','USGS 3D Elevation Program (3DEP)')}, public domain; ${A('https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer','USGSShadedReliefOnly tiles')}</td><td>US public domain</td></tr>
  <tr><td>Minerals</td><td>${A('https://mrdata.usgs.gov/mrds/','USGS MRDS')}; WVU / NETL rare earth sites</td><td>US public domain</td></tr>
  <tr><td>Oil &amp; gas wells</td><td>${A(WVGES_WELLS,'WVGES well layer')} built from ${A('https://dep.wv.gov/oil-and-gas/databaseinfo/Pages/default.aspx','WVDEP Office of Oil and Gas')} permits · courtesy of the ${A('https://www.wvgs.wvnet.edu/','West Virginia Geological and Economic Survey (WVGES)')}</td><td>⚠ No license posted; credit WVDEP and WVGES; written terms pending</td></tr>
  <tr><td>Flock / ALPR</td><td>${A('https://www.openstreetmap.org/copyright','OpenStreetMap')} via ${A('https://deflock.org','DeFlock')}</td><td>ODbL 1.0 — own file (alpr_odbl.geojson)</td></tr>
  <tr><td>EV charging stations</td><td>${A('https://afdc.energy.gov/stations/','U.S. DOE Alternative Fuels Data Center')} (NREL Alternative Fuel Stations API; public, currently available electric stations in WV)</td><td>US public domain</td></tr>
  <tr><td>Power plants</td><td>${A('https://www.eia.gov/electricity/data/eia860m/','EIA-860M Sep 2026')}</td><td>US public domain</td></tr>
  <tr><td>Transmission</td><td>OpenStreetMap (as on ${A('https://openinframap.org/copyright','Open Infrastructure Map')})</td><td>ODbL 1.0 — own file (transmission_odbl.geojson)</td></tr>
  <tr><td>Counties</td><td>US Census cartographic boundaries 2023</td><td>US public domain</td></tr>
  <tr><td>US view: data centers</td><td>${A('https://datacentersnearme.org/data','DataCentersNearMe')} redistributable download (15 Sep 2026; 666 campuses withheld by the source); state rates ${A('https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a','EIA Table 5.6.A')} Aug 2026; ${A('https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_20m.zip','Census 2024 states')}</td><td>ODbL 1.0 — own file (us/datacenters_odbl.geojson + ATTRIBUTION.txt); EIA and Census public domain</td></tr>
  <tr><td>Search: towns and counties</td><td>${A('https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html','U.S. Census Bureau 2024 Gazetteer Files')} (searched on your device; no outside geocoder)</td><td>US public domain</td></tr>
  <tr><td>Basemap</td><td>${A('https://openfreemap.org','OpenFreeMap')} / OpenMapTiles, © OpenStreetMap contributors</td><td>ODbL / free</td></tr></table>
  <p class="note">ODbL share-alike applies to the ODbL files if we publish a derived database. Look and layout are inspired by ArcGIS dashboards; no Esri code, components or basemaps are used.</p></div>`;
  $('#about').hidden=false; $('#about .x').onclick=()=>{$('#about').hidden=true}; $('#about').onclick=e=>{if(e.target.id==='about')$('#about').hidden=true};
}

/* ---------- view switch: West Virginia (all layers) <-> United States (data centers by state) ---------- */
const CONUS=[[-124.9,24.4],[-66.7,49.5]];
const US_LABEL={operating:'Operating',under_construction:'Under construction',permitted:'Permitted',proposed:'Proposed',unknown:'Not stated',withdrawn:'Withdrawn',rejected:'Rejected'};
const US_ORDER=['operating','under_construction','permitted','proposed','unknown','withdrawn','rejected'];
const US_COL={operating:'#4cc38a',under_construction:'#ffd34d',permitted:'#c08cff',proposed:'#ff6b5a',unknown:'#9fb0c0',withdrawn:'#6b6b6b',rejected:'#6b6b6b'};
const usOn={operating:true,under_construction:true,permitted:true,proposed:true,unknown:true,withdrawn:false,rejected:false};
let view='wv', US=null, usP=null, usSel=null, usPopup=null;
const US_IDS=['us-states-fill','us-states-line','us-dc-cl','us-dc-cn','us-dc-halo','us-dc-pt'];
function loadUS(){ if(!usP) usP=Promise.all([getJSON('data/us/stats.json'),getJSON('data/us/states.geojson'),getJSON('data/us/datacenters_odbl.geojson')]).then(([stats,states,dcs])=>{US={stats,states,dcs};return US}).catch(e=>{usP=null;throw e}); return usP }
const isUsOn=s=>!!usOn[s||'unknown'];
function usAgg(abbr){const rows=US.stats.roster.filter(r=>isUsOn(r.status)&&(!abbr||r.state===abbr)); const wm=rows.filter(r=>r.mw); const mw=wm.reduce((a,r)=>a+r.mw,0); let cost=0; const by={};
  wm.forEach(r=>{if(r.state) by[r.state]=(by[r.state]||0)+r.mw}); Object.entries(by).forEach(([s,v])=>{const st=US.stats.states[s]; if(st) cost+=v*1000*8760*0.5*st.rate_usd_kwh});
  return {n:rows.length,n_pin:rows.filter(r=>r.pin).length,n_mw:wm.length,mw,cost}}
function usStateMw(){const m={}; Object.keys(US.stats.states).forEach(a=>m[a]={n:0,mw:0,n_mw:0}); US.stats.roster.forEach(r=>{if(!isUsOn(r.status)||!m[r.state])return; m[r.state].n++; if(r.mw){m[r.state].mw+=r.mw;m[r.state].n_mw++}}); return m}
const money=u=>u>=1e9?'$'+fmt(u/1e9,1)+'<small>B</small>':'$'+fmt(u/1e6)+'<small>M</small>';
const fmtMw=mw=>mw>=1000?fmt(mw/1000,1)+'<small> GW</small>':fmt(mw,mw>=100?0:1)+'<small> MW</small>';
function usFill(){const b=US.stats.breaks,r=US.stats.colors.ramp,st=['step',['feature-state','mw'],r[0]]; b.forEach((x,i)=>st.push(x,r[i+1]||r[r.length-1]));
  return ['case',['==',['coalesce',['feature-state','n'],0],0],US.stats.colors.none,['==',['coalesce',['feature-state','mw'],0],0],US.stats.colors.zero,st]}
function usDcData(){return {type:'FeatureCollection',features:US.dcs.features.filter(f=>isUsOn(f.properties.status)&&(!usSel||f.properties.state===usSel))}}
function addUS(){
  if(map.getSource('us-states')) return;
  const sym=(map.getStyle().layers||[]).find(l=>l.type==='symbol'); const below=sym?sym.id:undefined;
  map.addSource('us-states',{type:'geojson',data:US.states,promoteId:'abbr'});
  map.addLayer({id:'us-states-fill',type:'fill',source:'us-states',layout:{visibility:'none'},paint:{'fill-color':usFill(),'fill-opacity':['interpolate',['linear'],['zoom'],3,0.78,6.5,0.62,8,0.2,10,0.07]}},below);
  map.addLayer({id:'us-states-line',type:'line',source:'us-states',layout:{visibility:'none'},paint:{'line-color':['case',['==',['feature-state','sel'],1],'#ffffff','#000000'],'line-width':['case',['==',['feature-state','sel'],1],2.2,0.6],'line-opacity':0.85}},below);
  map.addSource('us-dc',{type:'geojson',data:usDcData(),cluster:true,clusterMaxZoom:8,clusterRadius:42});
  map.addLayer({id:'us-dc-cl',type:'circle',source:'us-dc',filter:['has','point_count'],layout:{visibility:'none'},paint:{'circle-color':'#ff6b5a','circle-opacity':0.85,'circle-stroke-color':'#2a1010','circle-stroke-width':1,'circle-radius':['step',['get','point_count'],12,10,16,30,20,80,26]}});
  map.addLayer({id:'us-dc-cn',type:'symbol',source:'us-dc',filter:['has','point_count'],layout:{visibility:'none','text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Regular'],'text-size':11},paint:{'text-color':'#fff'}});
  map.addLayer({id:'us-dc-halo',type:'circle',source:'us-dc',filter:['!',['has','point_count']],layout:{visibility:'none'},paint:{'circle-radius':['interpolate',['linear'],['coalesce',['get','mw'],0],0,7,200,10,2000,16],'circle-color':'#ff6b5a','circle-opacity':0.16}});
  map.addLayer({id:'us-dc-pt',type:'circle',source:'us-dc',filter:['!',['has','point_count']],layout:{visibility:'none'},paint:{'circle-radius':['interpolate',['linear'],['coalesce',['get','mw'],0],0,4,200,6,2000,11],
    'circle-color':['match',['get','status'],...US_ORDER.flatMap(s=>[s,US_COL[s]]),'#9fb0c0'],'circle-stroke-color':'#111','circle-stroke-width':1.2}});
}
function usPaint(){if(!map.getSource('us-states'))return; const m=usStateMw(); Object.entries(m).forEach(([a,v])=>map.setFeatureState({source:'us-states',id:a},{mw:v.mw,n:v.n,sel:a===usSel?1:0}))}
function usRefresh(){usPaint(); const s=map.getSource('us-dc'); if(s) s.setData(usDcData()); renderCards(); renderCharts(); renderLegend()}
function usFit(abbr){map.setPadding({top:0,bottom:0,left:0,right:0}); const p=isPhone()?{top:120,left:14,right:14,bottom:200}:{top:120,left:($('body').classList.contains('nopanel')?20:330),right:390,bottom:40};
  if(!abbr){map.fitBounds(CONUS,{padding:p,duration:700});return} const b=US.stats.states[abbr]&&US.stats.states[abbr].bbox; if(b) map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:p,duration:800,maxZoom:abbr==='AK'?4.2:7.5})}
function usSelect(abbr,noFit){usSel=abbr||null; $('#detail').hidden=true; if(usPopup){usPopup.remove();usPopup=null} usRefresh(); if(!noFit) usFit(usSel)}
async function setView(v,o={}){
  if(v===view&&!o.force) return; 
  if(v==='us'){ try{await loadUS()}catch(e){toast('Could not load the US data. Check your connection and try again.');return} if(!window.__ready) await new Promise(r=>{const t=setInterval(()=>{if(window.__ready){clearInterval(t);r()}},100)}); addUS(); }
  view=v; document.body.classList.toggle('view-us',v==='us'); map.setMinZoom(v==='us'?1.8:5);
  $$('#viewsw button').forEach(b=>{b.classList.toggle('on',b.dataset.view===v);b.setAttribute('aria-pressed',b.dataset.view===v)});
  $('#top .sub').textContent=v==='us'?'United States':'West Virginia';
  const tl={layers:v==='us'?'Filters':'Layers',charts:v==='us'?'Top 5':'Charts'}; $$('.tab').forEach(t=>t.textContent=tl[t.dataset.tab]);
  document.title=(v==='us'?'Mines & Megawatts (Beta) · US data centers':'Mines & Megawatts (Beta) · West Virginia');
  $('#detail').hidden=true; if(usPopup){usPopup.remove();usPopup=null}
  US_IDS.forEach(i=>{if(map.getLayer(i)) map.setLayoutProperty(i,'visibility',v==='us'?'visible':'none')});
  applyVis();
  if(v==='us'){renderUSPanel(); usPaint(); const s=map.getSource('us-dc'); if(s) s.setData(usDcData()); if(!o.noFit) usFit(usSel)}
  else if(!o.noFit){ map.setPadding({top:0,bottom:0,left:0,right:0}); if(county){const b=cinfo[county].bbox;map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:pad(),maxZoom:10})} else map.fitBounds([[-82.65,37.2],[-77.72,40.64]],{padding:pad()}) }
  renderCards(); renderCharts(); renderLegend();
  try{history.replaceState(null,'',v==='us'?'#us':location.pathname+location.search)}catch(e){}
}
function renderUSPanel(){
  const counts={}; US.stats.roster.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
  const b=US.stats.breaks,r=US.stats.colors.ramp, s=US.stats.sources;
  $('#us-sections').innerHTML=`<div class="sec open"><div class="sec-h static"><span class="dot" style="background:var(--dc)"></span><span><span class="k">Demand · United States</span><span class="t">Data centers</span></span></div><div class="sec-b">
   <p class="note">States are shaded by <b>total stated MW</b>, not by how many sites they have. Most campuses have no stated MW ⚠. Tap a state to zoom in, or a pin for its card.</p>
   <div class="chips" id="us-status">${US_ORDER.map(k=>`<button class="chip ${usOn[k]?'on':''}" data-us="${k}"><i class="cdot" style="background:${US_COL[k]}"></i>${US_LABEL[k]} <span class="n">${fmt(counts[k]||0)}</span></button>`).join('')}</div>
   <div class="ramp"><div class="cap">Stated MW by state</div><div class="bar">${r.map(c=>`<i style="background:${c}"></i>`).join('')}</div><div class="lbl"><span>1 MW</span><span>${b.map(x=>x>=1000?x/1000+'k':x).join(' · ')}+</span></div>
   <div class="swatch"><i style="background:${US.stats.colors.zero}"></i>Campuses, no stated MW</div><div class="swatch"><i style="background:${US.stats.colors.none}"></i>No campuses in this filter</div></div>
   <p class="note"><button class="linkbtn" data-goview="wv">← Back to the West Virginia map (all layers)</button></p></div></div>
   <div class="sec open"><div class="sec-h static"><span class="dot" style="background:var(--acc)"></span><span><span class="k">Sources</span><span class="t">What's on this view</span></span></div><div class="sec-b">
   <p class="note">Campuses: ${A(s.campuses.url,'DataCentersNearMe')} redistributable download (ODbL 1.0, ${esc((s.campuses.generatedAt||'').slice(0,10))}), kept in its own file ${A('data/us/datacenters_odbl.geojson','datacenters_odbl.geojson')} with ${A('data/us/ATTRIBUTION.txt','ATTRIBUTION.txt')}. © OpenStreetMap contributors. Rates: ${A(US.stats.method.rate_url,'EIA Table 5.6.A')}, Aug 2026 state industrial averages (public domain). Boundaries: U.S. Census 2024 (public domain).</p>
   <p class="note warn">⚠ ${fmt(s.campuses.withheld)} campuses were withheld from the source download and are not shown. Directory MW can overlap or be overstated; proposed MW may never be built.</p></div></div>`;
  $$('#us-status .chip').forEach(c=>c.onclick=()=>{usOn[c.dataset.us]=!usOn[c.dataset.us];c.classList.toggle('on',usOn[c.dataset.us]);usRefresh()});
}
function renderUSCards(){
  if(!US) return; const a=usAgg(usSel), st=usSel?US.stats.states[usSel]:null, place=st?st.name:'United States';
  const C=(c,l,v,s)=>`<div class="card" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('#cards').innerHTML=C('var(--dc)','Data centers · '+esc(place),fmt(a.n),`${fmt(a.n_pin)} on the map · ${A(US.stats.sources.campuses.url,'DCNM')} ODbL`)+
    C('#e07b39','Stated capacity',fmtMw(a.mw),`${fmt(a.n_mw)} of ${fmt(a.n)} state a MW ⚠`)+
    C('var(--warn)','Est. annual power cost<span class="est">estimate</span>',money(a.cost),`50% load · ${st?fmt(st.rate_cents,2)+'¢/kWh ':'state rates · '}${A(US.stats.method.rate_url,'EIA')}`);
  $('#scope').classList.toggle('on',!!usSel); $('#scope').innerHTML=usSel?`<button aria-label="Back to all states">← United States</button>`:'';
  if(usSel) $('#scope button').onclick=()=>usSelect(null);
}
function usTop5Html(){const rows=Object.entries(usStateMw()).map(([a,v])=>({a,name:US.stats.states[a].name,...v})).sort((x,y)=>y.mw-x.mw||y.n-x.n).slice(0,5); const mx=(rows[0]&&rows[0].mw)||1;
  return `<h3>Top 5 states <small>by stated MW ⚠</small></h3><ol class="top5">${rows.map((s,i)=>`<li><button data-st="${s.a}" class="${s.a===usSel?'on':''}"><span class="rk">${i+1}</span><span class="nm">${esc(s.name)}</span><span class="mw">${s.mw>=1000?fmt(s.mw/1000,1)+' GW':fmt(s.mw)+' MW'}</span><small>${fmt(s.n)} campuses · ${fmt(s.n_mw)} with stated MW</small><span class="barrow"><i style="width:${Math.max(4,s.mw/mx*100)}%"></i></span></button></li>`).join('')}</ol>
  <p class="note">Estimate method: stated MW × 8,760 h × 50% load × each state's EIA industrial rate. ${A('#','Sources & method')}</p>`}
function renderUSCharts(){ if(!US) return; const tgt=isPhone()?$('#charts-m'):$('#charts'); (isPhone()?$('#charts'):$('#charts-m')).innerHTML=''; tgt.innerHTML=usTop5Html();
  tgt.querySelectorAll('button[data-st]').forEach(b=>b.onclick=()=>{usSelect(b.dataset.st); if(isPhone()){$('#panel').classList.remove('full');sheetVar()}});
  const a=tgt.querySelector('a[href="#"]'); if(a) a.onclick=e=>{e.preventDefault();about()} }
function renderUSLegend(){ if(!US) return; $('#legend-b').innerHTML='<div class="lgt">Data centers</div>'+US_ORDER.filter(k=>usOn[k]).map(k=>`<div class="lg"><i style="background:${US_COL[k]}"></i>${US_LABEL[k]}</div>`).join('')+'<div class="note">Size = stated MW · clusters = count</div><div class="lgt">States, stated MW</div><div class="lg"><i class="sq" style="background:linear-gradient(90deg,'+US.stats.colors.ramp.join(',')+')"></i>low → high</div>' }
function onClickUS(e){
  const fs=map.queryRenderedFeatures([[e.point.x-6,e.point.y-6],[e.point.x+6,e.point.y+6]],{layers:['us-dc-pt','us-dc-cl'].filter(i=>map.getLayer(i))});
  if(fs.length){const f=fs.find(x=>x.layer.id==='us-dc-pt')||fs[0];
    if(f.layer.id==='us-dc-cl'){map.getSource('us-dc').getClusterExpansionZoom(f.properties.cluster_id).then(z=>map.easeTo({center:f.geometry.coordinates,zoom:z}));return}
    const p=US.dcs.features.find(x=>x.properties.id===f.properties.id); showUSDetail(p.properties,p.geometry.coordinates); return}
  const s=map.queryRenderedFeatures(e.point,{layers:['us-states-fill']}); if(s.length){const a=s[0].properties.abbr; usSelect(a===usSel?null:a)}
}
function showUSDetail(p,ll){
  const st=US.stats.states[p.state], kwh=p.mw?p.mw*1000*8760*0.5:null, cost=kwh&&st?kwh*st.rate_usd_kwh:null;
  const kv=rows=>'<dl class="kv">'+rows.filter(r=>r[1]!=null&&r[1]!=='').map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')+'</dl>';
  const h=`<div class="kicker">${esc(st?st.name:p.state)} · data center</div><h2>${esc(p.name)}</h2><span class="pill ${esc(p.status)}">${esc(US_LABEL[p.status]||p.status)}</span>
   ${kv([['Operator',p.operator?esc(p.operator)+(/as-listed|applicant/.test(p.operatorHow||'')?' <span class="note">as listed ⚠</span>':''):'Not stated'],['Stated size',p.mw!=null?`<b>${fmt(p.mw,p.mw>=100?0:1)} MW</b> <span class="note">(source-reported${p.mwKind?', '+esc(p.mwKind):''}) ⚠</span>`:'Not stated'],['County',esc(p.county||'—')+(p.city?' · '+esc(p.city):'')],['Location',esc(p.loc||'unspecified')+' precision']])}
   ${cost!=null?`<div class="estbox"><div class="h">Estimate · not a reported figure</div><div class="big">≈ ${money(cost).replace(/<\/?small>/g,'')} / yr power</div><div class="m">${fmt(kwh/1e9,2)} TWh/yr at 50% load × ${fmt(st.rate_cents,2)}¢/kWh (${esc(st.rate_sector)} average, ${esc(st.name)}, ${A(US.stats.method.rate_url,'EIA Aug 2026')}). Large customers often have their own contracts ⚠.</div></div>`:'<p class="note">No stated MW, so no cost estimate.</p>'}
   <h3>Source</h3><ul class="srcs"><li>${A(p.srcUrl,'DataCentersNearMe record')} · ${esc(p.license||'ODbL 1.0')}${p.srcDate?' · '+esc(p.srcDate):''} · © OpenStreetMap contributors</li></ul>`;
  openDetail(h); if(ll){if(usPopup)usPopup.remove(); usPopup=new maplibregl.Popup({closeButton:false,offset:8}).setLngLat(ll).setHTML(`<b>${esc(p.name)}</b>`).addTo(map)}
}
function openDetail(h){const d=$('#detail'); d.innerHTML=`<button class="iconbtn x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`+h+`<p class="note">Not for engineering, legal, or investment decisions.</p>`; d.hidden=false; d.scrollTop=0; d.querySelector('.x').onclick=()=>{d.hidden=true;if(usPopup){usPopup.remove();usPopup=null}}}
function toast(t){let el=$('#toast'); if(!el){el=document.createElement('div');el.id='toast';el.setAttribute('role','status');document.body.appendChild(el)} el.textContent=t; el.classList.add('on'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('on'),4500)}

/* ---------- search: local index only (no outside geocoder) ---------- */
let SX=null, sxP=null, sxSel=-1, sxRes=[], sxMarker=null;
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const ST_NAMES={};
function loadSearch(){ if(!sxP) sxP=Promise.all([getJSON('data/search/places.json'),getJSON('data/search/wv_index.json'),loadUS()]).then(([pl,wv])=>{
  const E=[]; // [norm, kind, label, sub, payload]
  Object.values(US.stats.states).forEach(s=>{ST_NAMES[s.abbr]=s.name; E.push([norm(s.name),'state',s.name,'State · '+fmt(s.n_active)+' data center campuses',{abbr:s.abbr}])});
  pl.counties.forEach(c=>E.push([norm(c[0]),'county',c[0],(ST_NAMES[c[1]]||c[1]),{st:c[1],ll:[c[3],c[2]],geoid:c[4],name:c[0]}]));
  pl.places.forEach(p=>E.push([norm(p[0]),'place',p[0],(p[1]&&p[1]!=='CDP'?p[1][0].toUpperCase()+p[1].slice(1):p[1]==='CDP'?'Community':'Place')+' · '+(ST_NAMES[p[2]]||p[2]),{st:p[2],ll:[p[4],p[3]],name:p[0]}]));
  S.dc.features.forEach(f=>{const p=f.properties; E.push([norm(p.name),'wvdc',p.name,'WV data center · '+p.county+' Co.'+(p.mw?' · '+fmt(p.mw)+' MW':''),{id:p.id},norm(p.id)])});
  US.dcs.features.forEach(f=>{const p=f.properties; E.push([norm(p.name),'usdc',p.name,'Data center · '+[p.city,ST_NAMES[p.state]||p.state].filter(Boolean).join(', ')+(p.mw?' · '+fmt(p.mw)+' MW':''),{id:p.id},norm(p.id)+' '+norm(p.operator||'')])});
  wv.mines.forEach(m=>E.push([norm(m[1]),'mine',m[1],'Coal mine · MSHA '+m[0]+(m[4]?' · '+m[4]+' Co.':'')+(m[5]?' · '+m[5]:''),{id:m[0],ll:[m[2],m[3]],g:m[5]},m[0]]));
  wv.min.forEach(m=>E.push([norm(m[1]),'min',m[1],'Mineral site'+(m[0]?' · MRDS '+m[0]:'')+(m[4]?' · '+m[4]:''),{id:m[0],name:m[1],ll:[m[2],m[3]],g:m[5]},m[0]]));
  wv.pp.forEach(m=>E.push([norm(m[1]),'pp',m[1],'Power plant · EIA '+m[0]+(m[4]?' · '+m[4]+' Co.':'')+(m[5]?' · '+m[5]:''),{id:m[0],ll:[m[2],m[3]]},m[0]]));
  (wv.ev||[]).forEach(m=>E.push([norm(m[1]),'ev',m[1],'EV charging'+(m[5]==='dc'?' · DC fast':' · Level 2')+(m[6]?' · '+m[6]:'')+(m[4]?' · '+m[4]+' Co.':'')+(m[7]?' · '+m[7]:''),{id:m[0],ll:[m[2],m[3]]},String(m[0])+' '+norm(m[7]||'')]));
  SX=E; return E}).catch(e=>{sxP=null;throw e}); return sxP }
const KIND_W={state:30,county:22,wvdc:26,usdc:18,mine:14,min:12,pp:16,ev:17,place:20,well:40};
const KIND_L={state:'State',county:'County',place:'Town',wvdc:'Data center',usdc:'Data center',mine:'Coal mine',min:'Mineral',pp:'Power plant',ev:'EV charging',well:'Well'};
function searchRun(q){
  const n=norm(q), out=[]; if(n.length<2) return out;
  const digits=q.replace(/[^0-9]/g,'');
  if(/^[\s\d-]+$/.test(q)&&((digits.length===10&&digits.startsWith('47'))||digits.length===8)){const api=digits.length===10?digits:'47'+digits; out.push({s:digits.length===10?999:70,k:'well',label:'Well API '+api.slice(0,2)+'-'+api.slice(2,5)+'-'+api.slice(5),sub:'Oil / gas well · WV county '+api.slice(2,5),p:{api}})}
  const words=n.split(' ');
  for(const e of SX){const t=e[0]; let s=0;
    if(t===n||(e[1]==='county'&&t.replace(/ (county|parish|borough|census area|municipality|city and borough)$/,'')===n)) s=100; else if(t.startsWith(n)) s=80; else if(t.includes(' '+n)) s=62; else if(words.length>1&&words.every(w=>t.includes(w))) s=48; else if(n.length>=3&&t.includes(n)) s=36;
    if(!s&&e[5]){const id=e[5]; if(id===n) s=95; else if(n.length>=3&&id.includes(n)) s=40}
    if(!s) continue; s+=KIND_W[e[1]]||0; if(e[1]==='place'&&e[4].st==='WV') s+=8; if(e[1]==='county'&&e[4].st==='WV') s+=8; if(e[1]==='usdc'&&e[4]) s+=0;
    out.push({s,k:e[1],label:e[2],sub:e[3],p:e[4]})}
  out.sort((a,b)=>b.s-a.s||a.label.localeCompare(b.label)); return out.slice(0,40)
}
function openSearch(){const box=$('#search'); box.hidden=false; document.body.classList.add('searching'); const i=$('#sx-q'); setTimeout(()=>i.focus(),0); $('#btn-search').setAttribute('aria-expanded','true');
  if(!SX){$('#sx-r').innerHTML='<li class="sx-msg">Loading search index…</li>'; loadSearch().then(()=>renderSearch()).catch(()=>{$('#sx-r').innerHTML='<li class="sx-msg">Search index could not load. Check your connection.</li>'})} else renderSearch()}
function closeSearch(){$('#search').hidden=true; document.body.classList.remove('searching'); $('#btn-search').setAttribute('aria-expanded','false')}
function renderSearch(){const q=$('#sx-q').value; const ul=$('#sx-r'); if(!SX) return;
  if(norm(q).length<2){ul.innerHTML='<li class="sx-msg">Type a state, county, town, data center, mine, power plant, MSHA mine ID, or a WV well API number (e.g. 47-039-00008).</li>';sxRes=[];return}
  sxRes=searchRun(q); sxSel=sxRes.length?0:-1;
  ul.innerHTML=sxRes.length?sxRes.map((r,i)=>`<li role="option" id="sx-o${i}" aria-selected="${i===sxSel}" data-i="${i}" class="${i===sxSel?'on':''}"><span class="sx-k sx-${r.k}">${KIND_L[r.k]}</span><span class="sx-t">${esc(r.label)}</span><small>${esc(r.sub)}</small></li>`).join(''):'<li class="sx-msg">No matches in the loaded data.</li>';
  $('#sx-q').setAttribute('aria-activedescendant',sxSel>=0?'sx-o'+sxSel:'')}
function sxMove(d){if(!sxRes.length)return; sxSel=(sxSel+d+sxRes.length)%sxRes.length; $$('#sx-r li[data-i]').forEach(li=>{const on=+li.dataset.i===sxSel;li.classList.toggle('on',on);li.setAttribute('aria-selected',on);if(on)li.scrollIntoView({block:'nearest'})}); $('#sx-q').setAttribute('aria-activedescendant','sx-o'+sxSel)}
function pin(ll,label){if(sxMarker)sxMarker.remove(); sxMarker=new maplibregl.Popup({closeButton:false,offset:6,className:'sx-pop'}).setLngLat(ll).setHTML(`<b>${esc(label)}</b>`).addTo(map)}
function hav(a,b){const R=3958.8,r=Math.PI/180,dl=(b[1]-a[1])*r,dn=(b[0]-a[0])*r,x=Math.sin(dl/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function nearDC(ll){const all=US.dcs.features.map(f=>({f,d:hav(ll,f.geometry.coordinates)})).filter(x=>x.d<=25).sort((a,b)=>a.d-b.d); return all}
function placeCard(kind,label,sub,ll,st){
  const nd=nearDC(ll); const mw=nd.reduce((a,x)=>a+(x.f.properties.mw||0),0);
  const list=nd.slice(0,5).map(x=>`<li><button class="linkbtn" data-dc="${esc(x.f.properties.id)}">${esc(x.f.properties.name)}</button> · ${fmt(x.d,1)} mi${x.f.properties.mw?' · '+fmt(x.f.properties.mw)+' MW':''}</li>`).join('');
  openDetail(`<div class="kicker">${esc(kind)}</div><h2>${esc(label)}</h2><p class="note">${esc(sub)}</p>
   <dl class="kv"><dt>Data centers within 25 mi</dt><dd><b>${fmt(nd.length)}</b>${mw?' · '+fmt(mw)+' MW stated ⚠':''}</dd><dt>Location</dt><dd>${ll[1].toFixed(4)}, ${ll[0].toFixed(4)} (Census internal point)</dd></dl>
   ${list?`<h3>Nearest data centers</h3><ul class="srcs">${list}</ul>`:''}
   <h3>Source</h3><ul class="srcs"><li>${A('https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html','U.S. Census Bureau 2024 Gazetteer')} (public domain)</li><li>Data centers: ${A('https://datacentersnearme.org/data','DataCentersNearMe')} (ODbL 1.0)</li></ul>`);
  $$('#detail [data-dc]').forEach(b=>b.onclick=()=>goSearch({k:'usdc',p:{id:b.dataset.dc}}));
}
async function goSearch(r){
  closeSearch(); if(isPhone()){$('#panel').classList.remove('full');sheetVar()}
  const k=r.k,p=r.p; if(sxMarker){sxMarker.remove();sxMarker=null}
  if(county&&k!=='county'&&k!=='state') setCounty(null);
  if(k==='state'){ if(p.abbr==='WV'&&view==='wv'){setCounty(null);map.fitBounds([[-82.65,37.2],[-77.72,40.64]],{padding:pad()});showStateCard('WV');return}
    await setView('us',{noFit:true}); usSelect(p.abbr); showStateCard(p.abbr); return}
  if(k==='county'){ if(p.st==='WV'){const nm=p.name.replace(/ County$/,''); await setView('wv',{noFit:true}); if(cinfo[nm]){setCounty(nm,true); showCountyCard(nm)} return}
    await setView('us',{noFit:true}); usSelect(p.st,true); map.flyTo({center:p.ll,zoom:8.6,padding:pad()}); pin(p.ll,p.name); placeCard('County · '+(ST_NAMES[p.st]||p.st),p.name,'County internal point; boundaries not shown in the US view.',p.ll,p.st); return}
  if(k==='place'){ if(p.st==='WV') await setView('wv',{noFit:true}); else {await setView('us',{noFit:true}); usSelect(p.st,true)}
    map.flyTo({center:p.ll,zoom:11,padding:pad()}); pin(p.ll,p.name); placeCard(r.sub||'Town',p.name,r.sub||'',p.ll,p.st); return}
  if(k==='wvdc'){ await setView('wv',{noFit:true}); await fly('dc:'+p.id); return}
  if(k==='usdc'){ const f=US.dcs.features.find(x=>x.properties.id===p.id); if(!f) return; await setView('us',{noFit:true});
    if(!isUsOn(f.properties.status)){usOn[f.properties.status||'unknown']=true; renderUSPanel()} usSelect(f.properties.state,true); map.flyTo({center:f.geometry.coordinates,zoom:11.5,padding:pad()}); showUSDetail(f.properties,f.geometry.coordinates); return}
  if(k==='mine'){ await setView('wv',{noFit:true}); if(p.g&&!mineFilter[p.g]){mineFilter[p.g]=true; $$(`[data-mf="${p.g}"]`).forEach(c=>c.classList.add('on'))} coalYear=null; await setLayer('coal',true); applyMineFilter(); renderCharts();
    const f=S.coal.features.find(x=>x.properties.id===p.id); map.flyTo({center:p.ll,zoom:12.5,padding:pad()}); if(f) showDetail('coal',f.properties,f.geometry.coordinates); return}
  if(k==='min'){ await setView('wv',{noFit:true}); await setLayer('min',true); const g=p.g==='ree_site'?'ree':p.g; if(g&&!minGroups[g]){minGroups[g]=true; $$(`[data-mg="${g}"]`).forEach(c=>c.classList.add('on')); applyMinFilter()}
    const f=S.min.features.find(x=>(p.id&&String(x.properties.id)===p.id)||(!p.id&&x.properties.name===p.name)); map.flyTo({center:p.ll,zoom:12,padding:pad()}); if(f) showDetail('min',f.properties,f.geometry.coordinates); return}
  if(k==='pp'){ await setView('wv',{noFit:true}); await setLayer('pp',true); const f=S.pp.features.find(x=>String(x.properties.id)===p.id); map.flyTo({center:p.ll,zoom:12,padding:pad()}); if(f) showDetail('pp',f.properties,f.geometry.coordinates); return}
  if(k==='ev'){ await setView('wv',{noFit:true}); await setLayer('ev',true); const f=S.ev.features.find(x=>String(x.properties.id)===String(p.id)); map.flyTo({center:p.ll,zoom:13,padding:pad()}); if(f) showDetail('ev-pt',f.properties,f.geometry.coordinates); return}
  if(k==='well'){ await setView('wv',{noFit:true}); const fips='54'+p.api.slice(2,5); let rows=[]; try{rows=await getJSON('data/wells/'+fips+'.json')}catch(e){toast('No well file for county code '+p.api.slice(2,5)+'.');return}
    const row=rows.find(x=>String(x[2])===p.api); if(!row){toast('Well API '+p.api+' is not in the WVGES layer we loaded.');return}
    await setLayer('wells',true); map.flyTo({center:[row[0],row[1]],zoom:14,padding:pad()}); pin([row[0],row[1]],'API '+p.api);
    showDetail('wells-pt',{api:row[2],t:row[3],s:row[4],y:row[5],op:row[6],fld:row[7]},[row[0],row[1]]); return}
}
function showStateCard(abbr){ const st=US.stats.states[abbr]; if(!st) return; const a=usAgg(abbr);
  openDetail(`<div class="kicker">State</div><h2>${esc(st.name)}</h2><dl class="kv"><dt>Data centers</dt><dd><b>${fmt(a.n)}</b> campuses (${fmt(a.n_pin)} pinned)</dd><dt>Stated capacity</dt><dd>${fmtMw(a.mw).replace(/<\/?small>/g,'')} from ${fmt(a.n_mw)} campuses ⚠</dd><dt>Industrial rate</dt><dd>${fmt(st.rate_cents,2)}¢/kWh, Aug 2026 (${A(US.stats.method.rate_url,'EIA')})</dd></dl>
   <div class="estbox"><div class="h">Estimate · not a reported figure</div><div class="big">≈ ${money(a.cost).replace(/<\/?small>/g,'')} / yr power</div><div class="m">Stated MW × 8,760 h × 50% load × the state industrial rate. Directory MW can overlap or be overstated ⚠.</div></div>
   ${abbr==='WV'?`<p><button class="linkbtn" data-goview="wv">Open the West Virginia map with every layer →</button></p>`:''}
   <h3>Sources</h3><ul class="srcs"><li>${A('https://datacentersnearme.org/data','DataCentersNearMe')} (ODbL 1.0)</li><li>${A(US.stats.method.rate_url,'EIA Electric Power Monthly Table 5.6.A')} (public domain)</li></ul>`)}
function showCountyCard(nm){ const c=S.st.county[nm]||{}; const dcs=S.dc.features.filter(f=>f.properties.county===nm); const mw=dcs.reduce((a,f)=>a+(f.properties.inTotal?f.properties.mw||0:0),0);
  const coal=S.st.coal_county[nm]||{}; const yrs=Object.keys(coal).sort(); const ly=yrs[yrs.length-1];
  openDetail(`<div class="kicker">West Virginia county</div><h2>${esc(nm)} County</h2><dl class="kv"><dt>Data centers</dt><dd>${fmt(dcs.length)}${mw?' · '+fmt(mw)+' MW stated ⚠':''}</dd><dt>Oil &amp; gas wells</dt><dd>${fmt(c.wells||0)} (WVGES ⚠)</dd><dt>Coal production</dt><dd>${ly?fmt(coal[ly])+' short tons ('+ly+', EIA)':'None in the EIA years used'}</dd><dt>Critical-mineral sites</dt><dd>${fmt(c.min||0)} (USGS MRDS)</dd></dl>
   <p class="note">The cards and charts now show this county. Tap the county chip at the top to clear it.</p>
   <h3>Sources</h3><ul class="srcs"><li>${A('https://www.eia.gov/coal/data.cfm','EIA coal data')} · ${A(WVGES_WELLS,'WVGES well layer')} · ${A('https://mrdata.usgs.gov/mrds/','USGS MRDS')} · ${A('https://datacentersnearme.org/data','DataCentersNearMe')} / ${A('https://datacenterdata.com/data/','DataCenterData')}</li></ul>`)}
function initSearchAndView(){
  $('#btn-search').onclick=()=>$('#search').hidden?openSearch():closeSearch();
  $('#sx-x').onclick=closeSearch;
  $('#sx-q').addEventListener('input',()=>renderSearch());
  $('#sx-q').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();sxMove(1)} else if(e.key==='ArrowUp'){e.preventDefault();sxMove(-1)} else if(e.key==='Enter'){e.preventDefault();if(sxRes[sxSel]) goSearch(sxRes[sxSel])} else if(e.key==='Escape'){closeSearch()}});
  $('#sx-r').addEventListener('click',e=>{const li=e.target.closest('li[data-i]'); if(li) goSearch(sxRes[+li.dataset.i])});
  $$('#viewsw button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
  document.addEventListener('click',e=>{const g=e.target.closest('[data-goview]'); if(g){e.preventDefault(); setView(g.dataset.goview)}});
  addEventListener('hashchange',()=>{if(window.__ready) setView(/^#us\b/.test(location.hash)?'us':'wv')});
  addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea/i.test((document.activeElement||{}).tagName||'')){e.preventDefault();openSearch()}});
}
/* ---------- offline notice (the map background needs internet; app data is bundled) ---------- */
function offlineInit(){
  const show=on=>{const o=$('#offline'); if(o) o.hidden=!on};
  addEventListener('offline',()=>show(true)); addEventListener('online',()=>{show(false); if(!window.__ready) location.reload()});
  if(navigator.onLine===false) show(true);
  $('#offline-retry').onclick=()=>location.reload();
  setTimeout(()=>{if(!window.__ready) show(true)},15000);
}

window.__ll={fly,setLayer,setCounty,showDetail,setView,usSelect,searchRun:q=>SX?searchRun(q):null,loadSearch,goSearch,openSearch,get view(){return view},get US(){return US},get S(){return S},get map(){return map}};
})();
