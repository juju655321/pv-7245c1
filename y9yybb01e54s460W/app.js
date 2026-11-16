/* Lode & Load — WV prototype. MapLibre GL JS + OpenFreeMap. No Esri code; look borrowed from ArcGIS dashboards as a design reference. */
(function(){
'use strict';
const PWH='ce15069e664c226c2bed0e2851d320480161b39c6707e72e56e832a0177838af', SALT='lodeandload-preview:';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const fmt=(n,d=0)=>n==null?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d});
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const A=(u,t)=>`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`;
const isPhone=()=>matchMedia('(max-width:760px)').matches;
const WVGES_MINED='https://atlas.wvgs.wvnet.edu/arcgis/rest/services/Coal_Web_Mercator/All_Mining_WM/MapServer';
const WVGES_WELLS='https://atlas2.wvgs.wvnet.edu/server/rest/services/OilGas_WVOG/WVOG_Layer/MapServer/4';
const S={dc:null,coal:null,min:null,pp:null,tx:null,alpr:null,cty:null,st:null};
let map, county=null, coalYear=null, mineFilter={active:true,idle:true,abandoned:false}, minGroups={copper:true,battery:true,ree:true,other:false};
const wellsLoaded={}, wellRows=[]; let cinfo={};

/* ---------- gate ---------- */
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function unlock(){document.body.classList.remove('locked');$('#gate').remove();start()}
document.body.classList.add('locked');
if(sessionStorage.getItem('ll_ok')===PWH) unlock();
else $('#gate-f').addEventListener('submit',async e=>{e.preventDefault();
  const h=await sha(SALT+$('#gate-p').value);
  if(h===PWH){sessionStorage.setItem('ll_ok',PWH);unlock()} else {$('#gate-e').textContent='Wrong password.'}});

/* ---------- boot ---------- */
async function getJSON(u){const r=await fetch(u);if(!r.ok) throw new Error(u+' '+r.status);return r.json()}
async function start(){
  map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/dark',center:[-80.18,38.9],zoom:6.4,minZoom:5,maxZoom:17,attributionControl:false,hash:false});
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'Data credits: tap Sources · © OpenStreetMap contributors (ODbL)'}),'bottom-right');
  map.addControl(new maplibregl.NavigationControl({visualizePitch:false}),'top-right');
  map.addControl(new HomeCtl(),'top-right');
  map.addControl(new maplibregl.GeolocateControl({trackUserLocation:false}),'top-right');
  map.addControl(new maplibregl.ScaleControl({unit:'imperial'}),'bottom-right');
  const [dc,cty,st]=await Promise.all([getJSON('data/datacenters_odbl.geojson'),getJSON('data/counties.geojson'),getJSON('data/stats.json')]);
  S.dc=dc;S.cty=cty;S.st=st;
  cty.features.forEach(f=>{const cs=(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).flat(2);
    let a=[180,90,-180,-90];cs.forEach(([x,y])=>{a=[Math.min(a[0],x),Math.min(a[1],y),Math.max(a[2],x),Math.max(a[3],y)]});cinfo[f.properties.name]={bbox:a,fips:f.properties.fips}});
  buildPanel(); renderCards(); renderCharts(); renderLegend();
  map.on('load',()=>{const at=document.querySelector('.maplibregl-ctrl-attrib');if(at&&isPhone())at.classList.remove('maplibregl-compact-show');addBase();addDC();ensure('coal');ensure('alpr');applyVis();window.__ready=true});
  map.on('error',e=>{if(e&&e.error&&!/tile|Failed to fetch|AbortError/i.test(String(e.error.message||''))) console.warn('map',e.error.message)});
  map.on('click',onClick);
  map.on('moveend',loadWells);
  addEventListener('resize',()=>{renderCharts()});
}
class HomeCtl{onAdd(m){const d=document.createElement('div');d.className='maplibregl-ctrl maplibregl-ctrl-group home-btn';d.innerHTML='<button type="button" title="Whole state" aria-label="Zoom to whole state"><svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/></svg></button>';d.onclick=()=>{setCounty(null);m.fitBounds([[-82.65,37.2],[-77.72,40.64]],{padding:pad()})};return d}onRemove(){}}
function pad(){return isPhone()?{top:110,bottom:180,left:20,right:20}:{top:110,bottom:40,left:($('body').classList.contains('nopanel')?20:330),right:220}}

/* ---------- layers ---------- */
const LAY={dc:true,coal:true,mined:false,min:false,wells:false,alpr:false,pp:false,tx:false};
function addBase(){
  map.addSource('cty',{type:'geojson',data:S.cty,promoteId:'fips'});
  const wc=['match',['get','fips']]; S.cty.features.forEach(f=>{wc.push(f.properties.fips,(S.st.county[f.properties.name]||{}).wells||0)}); wc.push(0);
  map.addLayer({id:'cty-wells',type:'fill',source:'cty',maxzoom:9.5,paint:{'fill-color':['interpolate',['linear'],wc,0,'#1d1730',1000,'#3b2a66',4000,'#6a46b0',8000,'#9a6ee0',12000,'#d4b8ff'],'fill-opacity':0.55},layout:{visibility:'none'}});
  map.addLayer({id:'cty-line',type:'line',source:'cty',paint:{'line-color':'#8a8a8a','line-width':['interpolate',['linear'],['zoom'],6,0.4,10,1.2],'line-opacity':0.6}});
  map.addLayer({id:'cty-sel',type:'line',source:'cty',paint:{'line-color':'#3fa9f5','line-width':2.5},filter:['==',['get','fips'],'']});
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
    applyMineFilter(); renderCards();}
  if(k==='min'&&!S.min){S.min=await getJSON('data/minerals.geojson');
    map.addSource('min',{type:'geojson',data:S.min});
    map.addLayer({id:'min',type:'circle',source:'min',paint:{'circle-radius':['match',['get','g'],'ree_site',8,4.5],'circle-color':['match',['get','g'],'copper','#e07b39','battery','#2fc4b2','ree','#d65cff','ree_site','#d65cff','#8fa3b8'],'circle-stroke-color':['match',['get','g'],'ree_site','#fff','#000'],'circle-stroke-width':['match',['get','g'],'ree_site',2,0.6]}},'dc-halo');
    applyMinFilter(); renderCards();}
  if(k==='alpr'&&!S.alpr){S.alpr=await getJSON('data/alpr_odbl.geojson');
    map.addSource('alpr',{type:'geojson',data:S.alpr});
    map.addLayer({id:'alpr',type:'circle',source:'alpr',paint:{'circle-radius':['interpolate',['linear'],['zoom'],6,3,13,7],'circle-color':['case',['get','flock'],'#ff4fa3','#ff9ccd'],'circle-stroke-color':'#000','circle-stroke-width':0.8}},'dc-halo');
    renderCards();}
  if(k==='pp'&&!S.pp){S.pp=await getJSON('data/power_plants.geojson');
    map.addSource('pp',{type:'geojson',data:S.pp});
    map.addLayer({id:'pp',type:'circle',source:'pp',paint:{'circle-radius':['interpolate',['linear'],['get','mw'],0,3,500,7,3000,14],'circle-color':['match',['get','fuel'],'coal','#8c6d3f','gas','#5ab0ff','hydro','#3cd0e0','wind','#a0e070','solar','#ffe066','battery','#ff9f43','#999'],'circle-opacity':0.85,'circle-stroke-color':['case',['==',['get','stat'],'planned'],'#fff','#000'],'circle-stroke-width':1}},'dc-halo');}
  if(k==='tx'&&!S.tx){S.tx=await getJSON('data/transmission_odbl.geojson');
    map.addSource('tx',{type:'geojson',data:S.tx});
    map.addLayer({id:'tx',type:'line',source:'tx',paint:{'line-color':['interpolate',['linear'],['get','kv'],69,'#2f5f8a',138,'#3f8fd0',345,'#7cc4ff',765,'#e0f2ff'],'line-width':['interpolate',['linear'],['get','kv'],69,0.6,500,1.8,765,2.6],'line-opacity':0.8}},'cty-sel');}
  if(k==='wells'){if(!map.getSource('wells')){map.addSource('wells',{type:'geojson',data:{type:'FeatureCollection',features:[]},cluster:true,clusterRadius:40,clusterMaxZoom:11});
    map.addLayer({id:'wells-cl',type:'circle',source:'wells',filter:['has','point_count'],minzoom:9.5,paint:{'circle-radius':['interpolate',['linear'],['get','point_count'],10,10,500,20,3000,28],'circle-color':'#7a52c7','circle-opacity':0.8,'circle-stroke-color':'#d4b8ff','circle-stroke-width':1}},'dc-halo');
    map.addLayer({id:'wells-cn',type:'symbol',source:'wells',filter:['has','point_count'],minzoom:9.5,layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Regular'],'text-size':11},paint:{'text-color':'#fff'}});
    map.addLayer({id:'wells-pt',type:'circle',source:'wells',filter:['!',['has','point_count']],minzoom:9.5,paint:{'circle-radius':4,'circle-color':['match',['get','t'],'gas','#b07cff','oil','#3dd68c','og','#4fc3f7','dry','#777','#bbb'],'circle-stroke-color':'#000','circle-stroke-width':0.6}},'dc-halo');}
    loadWells();}
}
function applyVis(){
  const v=(id,on)=>{if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',on?'visible':'none')};
  ['dc','dc-halo','dc-lbl'].forEach(i=>v(i,LAY.dc)); v('coal',LAY.coal); v('mined',LAY.mined); v('min',LAY.min); v('alpr',LAY.alpr); v('pp',LAY.pp); v('tx',LAY.tx);
  ['cty-wells','wells-cl','wells-cn','wells-pt'].forEach(i=>v(i,LAY.wells));
  renderLegend();
}
async function setLayer(k,on){LAY[k]=on; if(on&&k!=='dc'&&k!=='mined') await ensure(k); applyVis(); $$(`input[data-lay="${k}"]`).forEach(i=>i.checked=on); renderCards()}
function applyMineFilter(){if(!map.getLayer('coal'))return; const gs=Object.keys(mineFilter).filter(k=>mineFilter[k]);
  const f=['all',['in',['get','g'],['literal',gs]]]; if(coalYear) f.push(['in','|'+coalYear+'|',['coalesce',['get','yrs'],'']]);
  map.setFilter('coal',f)}
function applyMinFilter(){if(!map.getLayer('min'))return; const gs=Object.keys(minGroups).filter(k=>minGroups[k]); if(minGroups.ree) gs.push('ree_site'); map.setFilter('min',['in',['get','g'],['literal',gs]])}
async function loadWells(){
  if(!LAY.wells||!map||map.getZoom()<9.5) return;
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
function sw(k,label){return `<label class="sw"><input type="checkbox" data-lay="${k}" ${LAY[k]?'checked':''}> ${esc(label)}</label>`}
function buildPanel(){
  $('#sections').innerHTML=SECS.map((s,i)=>`<div class="sec ${i===0?'open':''}" data-i="${i}"><button class="sec-h" aria-expanded="${i===0}"><span class="dot" style="background:${s.c}"></span><span><span class="k">${s.k}</span><span class="t">${s.t}</span></span><span></span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button><div class="sec-b">${s.body()}</div></div>`).join('')+
   `<div class="sec"><div class="sec-b" style="display:block"><p class="note">Working name; not final. Private prototype, Nov 16, 2026. ${A('#','Sources & method')}</p></div></div>`;
  $$('.sec-h').forEach(b=>b.onclick=()=>{const s=b.parentElement, i=+s.dataset.i, o=!s.classList.contains('open'); s.classList.toggle('open',o); b.setAttribute('aria-expanded',o); if(o) setTimeout(()=>s.scrollIntoView({block:'start',behavior:'auto'}),0); if(o&&SECS[i].lay&&!LAY[SECS[i].lay]) setLayer(SECS[i].lay,true)});
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
function renderCards(){
  if(!S.dc) return; const sm=S.dc.summary, cs=county?S.st.county[county]:null;
  const dcs=S.dc.features.filter(inCounty), mw=dcs.reduce((a,f)=>a+(f.properties.inTotal?f.properties.mw:0),0);
  const cost=mw*1000*8760*0.5*sm.method.rate_usd_kwh;
  const mines=S.coal?S.coal.features.filter(f=>(!county||f.properties.county===county)):null;
  const act=mines?mines.filter(f=>f.properties.g==='active').length:null;
  const wells=county?(cs.wells||0):S.st.wells_total;
  const alpr=S.alpr?S.alpr.features.filter(f=>ptIn(county,f)):null;
  const mins=county?cs.min:Object.values(S.st.county).reduce((a,c)=>a+(c.min||0),0);
  const C=(c,l,v,s)=>`<div class="card" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  $('#cards').innerHTML=
   C('var(--dc)','Data center MW (stated)',fmt(mw)+' <small>MW</small>',county?`${dcs.length} site${dcs.length===1?'':'s'} · ${A('https://datacenterdata.com/data/','src')}`:`${fmt(mw/sm.wv_capacity_mw*100)}% of WV capacity ⚠ · ${A(sm.wv_cap_url,'EIA')}`)+
   C('var(--warn)','Est. annual power cost<span class="est">estimate</span>','$'+(cost>=1e9?fmt(cost/1e9,2)+'<small>B</small>':fmt(cost/1e6)+'<small>M</small>'),`at 8.34¢/kWh, 50% load · ${A(sm.method.rate_url,'rate')} · ${A('#method','method')}`)+
   C('var(--coal)','Coal mines (MSHA)',act==null?'…':fmt(act)+' <small>active</small>',mines?`${fmt(mines.length)} on record · ${A('https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA.asp','MSHA')}`:'loading')+
   C('var(--well)','Oil & gas wells',fmt(wells),`WVGES well layer ⚠ terms pending · ${A(WVGES_WELLS,'src')}`)+
   C('var(--alpr)','Flock cameras',alpr?fmt(alpr.filter(f=>f.properties.flock).length):'…',alpr?`${fmt(alpr.length)} ALPR total · ${A('https://www.openstreetmap.org/copyright','OSM')} ODbL`:'loading')+
   C('var(--min)','Critical-mineral sites (WV)',mins==null?'…':fmt(mins),`USGS MRDS · ${A('https://mrdata.usgs.gov/mrds/','src')}`);
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
  const L=[];
  if(LAY.dc) L.push('<div class="lgt">Data centers</div>'+[['#ff6b5a','Proposed'],['#c08cff','Permitted'],['#ffd34d','Under construction'],['#4cc38a','Operating']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join('')+'<div class="note">Size = stated MW</div>');
  if(LAY.coal) L.push('<div class="lgt">Coal mines</div>'+[['#f5c242','Active'],['#b88a2e','Idle'],['#6d6249','Abandoned']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join(''));
  if(LAY.mined) L.push('<div class="lg"><i class="sq" style="background:#7a6a50"></i>Mined areas (WVGES)</div>');
  if(LAY.min) L.push('<div class="lgt">Minerals</div>'+[['#e07b39','Copper'],['#2fc4b2','Battery'],['#d65cff','Rare earths'],['#8fa3b8','Other critical']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join(''));
  if(LAY.wells) L.push('<div class="lgt">Wells</div><div class="lg"><i class="sq" style="background:linear-gradient(90deg,#1d1730,#d4b8ff)"></i>Wells per county</div>'+[['#b07cff','Gas'],['#3dd68c','Oil'],['#4fc3f7','Oil & gas'],['#777','Dry']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join(''));
  if(LAY.alpr) L.push('<div class="lgt">ALPR cameras</div><div class="lg"><i style="background:#ff4fa3"></i>Flock Safety</div><div class="lg"><i style="background:#ff9ccd"></i>Other / unknown</div>');
  if(LAY.pp) L.push('<div class="lgt">Power plants</div>'+[['#8c6d3f','Coal'],['#5ab0ff','Gas'],['#3cd0e0','Hydro'],['#a0e070','Wind'],['#ffe066','Solar']].map(([c,t])=>`<div class="lg"><i style="background:${c}"></i>${t}</div>`).join(''));
  if(LAY.tx) L.push('<div class="lg"><i class="ln" style="background:#7cc4ff"></i>Transmission (kV)</div>');
  $('#legend-b').innerHTML=L.join('')||'<div class="note">No layers on</div>';
}

/* ---------- click: feature card, else county ---------- */
function onClick(e){
  const ids=['dc','min','alpr','pp','coal','wells-pt','wells-cl','tx'].filter(i=>map.getLayer(i)&&map.getLayoutProperty(i,'visibility')!=='none');
  const fs=map.queryRenderedFeatures([[e.point.x-6,e.point.y-6],[e.point.x+6,e.point.y+6]],{layers:ids});
  if(fs.length){const f=fs[0],id=f.layer.id;
    if(id==='wells-cl'){map.getSource('wells').getClusterExpansionZoom(f.properties.cluster_id).then(z=>map.easeTo({center:f.geometry.coordinates,zoom:z}));return}
    let p=f.properties; if(id==='dc') p=S.dc.features.find(x=>x.properties.id===p.id).properties;
    if(id==='min'&&p.g==='ree_site') p=S.min.features.find(x=>x.properties.name===p.name).properties;
    showDetail(id,p,f.geometry.type==='Point'?f.geometry.coordinates:[e.lngLat.lng,e.lngLat.lat]); return}
  const c=map.queryRenderedFeatures(e.point,{layers:['cty-line','cty-wells'].filter(i=>map.getLayer(i))});
  let n=null; for(const [name,ci] of Object.entries(cinfo)){const b=ci.bbox,{lng,lat}=e.lngLat; if(lng>=b[0]&&lng<=b[2]&&lat>=b[1]&&lat<=b[3]){const save=county;county=name;const hit=pointInCounty(lng,lat);county=save;if(hit){n=name;break}}}
  setCounty(n===county?null:n);
}
function setCounty(n,fit){county=n; if(n&&fit){const b=cinfo[n].bbox;map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:pad(),maxZoom:10})} if(map.getLayer('cty-sel')) map.setFilter('cty-sel',['==',['get','fips'],n?cinfo[n].fips:'']); renderCards(); renderCharts();
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
  <p><b>For information only. Not for engineering, legal, or investment decisions.</b> ⚠ marks anything unverified. Lode &amp; Load is a working name.</p>
  <h3>Data center cost estimate</h3><p>Annual kWh = stated MW × 1,000 × 8,760 h × ${m.load_factor*100}% load. Power cost = kWh × ${(m.rate_usd_kwh*100).toFixed(2)}¢ (${A(m.rate_url,'EIA Electric Power Monthly Table 5.6.A, WV industrial, Aug 2026')}). On-site water = kWh × ${m.wue_l_kwh} L/kWh (${A(m.lbnl_url,'LBNL 2024 report')}). Real filed figures (e.g. the Ridgeline air permit) are shown first on each card. De-duplicated stated total: ${fmt(sm.total_mw,1)} MW ≈ $${fmt(sm.est.cost_musd)}M/yr ≈ ${fmt(sm.est.twh,1)} TWh (${fmt(sm.est.share_sales_pct)}% of WV 2024 retail sales of ${sm.wv_sales_twh} TWh).</p>
  <table><tr><th>Layer</th><th>Source</th><th>License</th></tr>
  <tr><td>Data centers</td><td>${A('https://datacentersnearme.org/data','DataCentersNearMe')}; ${A('https://datacenterdata.com/data/','DataCenterData')}; ${A('https://publicevidence.org/data/national-data-center-public-records','Public Evidence Project')} (0 WV records); ${A('https://im3.pnnl.gov/datacenter-atlas','PNNL IM3')} via OSM; WVDEP air permit R13-3713</td><td>ODbL 1.0 / CC BY 4.0 — kept in its own file (datacenters_odbl.geojson)</td></tr>
  <tr><td>Coal mines</td><td>${A('https://arlweb.msha.gov/OpenGovernmentData/OGIMSHA.asp','MSHA Mines data set')}; ${A('https://www.eia.gov/coal/data.cfm','EIA coal production')}</td><td>US public domain</td></tr>
  <tr><td>Mined areas</td><td>${A('https://www.wvgs.wvnet.edu/www/coal/cbmp/coalims.html','West Virginia Geological and Economic Survey, Coal Bed Mapping Program')} (live map service)</td><td>Public data; cite WVGES ⚠ written terms pending</td></tr>
  <tr><td>Minerals</td><td>${A('https://mrdata.usgs.gov/mrds/','USGS MRDS')}; WVU / NETL rare earth sites</td><td>US public domain</td></tr>
  <tr><td>Oil &amp; gas wells</td><td>${A(WVGES_WELLS,'WVGES well layer')} built from ${A('https://dep.wv.gov/oil-and-gas/databaseinfo/Pages/default.aspx','WVDEP Office of Oil and Gas')} permits</td><td>⚠ No license posted; credit WVDEP and WVGES; written terms pending</td></tr>
  <tr><td>Flock / ALPR</td><td>${A('https://www.openstreetmap.org/copyright','OpenStreetMap')} via ${A('https://deflock.org','DeFlock')}</td><td>ODbL 1.0 — own file (alpr_odbl.geojson)</td></tr>
  <tr><td>Power plants</td><td>${A('https://www.eia.gov/electricity/data/eia860m/','EIA-860M Sep 2026')}</td><td>US public domain</td></tr>
  <tr><td>Transmission</td><td>OpenStreetMap (as on ${A('https://openinframap.org/copyright','Open Infrastructure Map')})</td><td>ODbL 1.0 — own file (transmission_odbl.geojson)</td></tr>
  <tr><td>Counties</td><td>US Census cartographic boundaries 2023</td><td>US public domain</td></tr>
  <tr><td>Basemap</td><td>${A('https://openfreemap.org','OpenFreeMap')} / OpenMapTiles, © OpenStreetMap contributors</td><td>ODbL / free</td></tr></table>
  <p class="note">ODbL share-alike applies to the ODbL files if we publish a derived database. Look and layout are inspired by ArcGIS dashboards; no Esri code, components or basemaps are used.</p></div>`;
  $('#about').hidden=false; $('#about .x').onclick=()=>{$('#about').hidden=true}; $('#about').onclick=e=>{if(e.target.id==='about')$('#about').hidden=true};
}
window.__ll={fly,setLayer,setCounty,showDetail,get S(){return S},get map(){return map}};
})();
