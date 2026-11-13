'use strict';

// Navegação baseada nas instruções reais geradas pelo motor BRouter.
const nav = {
  routes:{}, selected:null, active:false, pending:false,
  follow:true, sound:true, marker:null, circle:null,
  lastFix:null, progressed:false, progress:0,
  announcements:new Set(), offRouteCount:0,
  lastReroute:0, rerouting:false, begunAt:0,
  headingMode:true, heading:null, headingSource:null, lastHeadingGPS:null,
  radarNotified:new Set(), lastRadarVoice:0, lastVoice:0
};
const navEl=id=>document.getElementById(id);
const navMeters=m=>m>=1000?(m/1000).toFixed(m<10000?1:0).replace('.',',')+' km':Math.round(Math.max(0,m)/10)*10+' m';
const navTime=s=>s>=3600?Math.round(s/3600)+' h '+Math.round((s%3600)/60)+' min':Math.max(1,Math.round(s/60))+' min';
function navTurnText(cmd, exit){
  switch(Number(cmd)){
    case 1: return 'Siga em frente';
    case 2: return 'Vire à esquerda';
    case 3: return 'Vire levemente à esquerda';
    case 4: return 'Vire acentuadamente à esquerda';
    case 5: return 'Vire à direita';
    case 6: return 'Vire levemente à direita';
    case 7: return 'Vire acentuadamente à direita';
    case 8: return 'Mantenha-se à esquerda';
    case 9: return 'Mantenha-se à direita';
    case 10: case 11: case 15: return 'Faça o retorno';
    case 13: case 14:
      return Number(exit)?'Na rotatória, pegue a saída número '+Math.abs(Number(exit)):
        'Entre na rotatória e siga a saída indicada';
    case 16:return 'Siga pelo trecho indicado';
    case 17:return 'Saia pela esquerda';
    case 18:return 'Saia pela direita';
    default:return 'Siga a rota destacada';
  }
}
function navParse(raw){
  const result=typeof raw==='string'?JSON.parse(raw):raw;
  const feature=(result.features||[]).find(f=>f.geometry?.type==='LineString');
  if(!feature)throw Error('Traçado incompleto.');
  const coords=feature.geometry.coordinates.map(p=>[Number(p[1]),Number(p[0])]);
  if(coords.length<2)throw Error('Traçado sem pontos suficientes.');
  const cumulative=[0];
  for(let i=1;i<coords.length;i++)cumulative[i]=cumulative[i-1]+1000*km(coords[i-1],coords[i]);
  const hints=(feature.properties?.voicehints||[])
    .filter(h=>Array.isArray(h)&&Number(h[0])>=0&&Number(h[0])<coords.length)
    .map(h=>({index:Number(h[0]),cmd:Number(h[1]),exit:Number(h[2])}))
    .filter(h=>h.cmd!==12)
    .sort((a,b)=>a.index-b.index);
  return {
    coords,cumulative,hints,length:cumulative[cumulative.length-1],
    totalSeconds:Number(feature.properties?.['total-time'])||0
  };
}
function navSelect(key){
  if(!nav.routes[key])return;
  nav.selected=key;
  nav.progressed=false;nav.progress=0;nav.announcements.clear();
  nav.offRouteCount=0;
  nav.radarNotified.clear();
  navPrepareRadarWarnings();
  navEl('navStartBtn').disabled=false;
  navEl('navSelection').textContent='Rota selecionada: '+(key==='alternate'?'alternativa por bairros':'comum')+
    '. Toque em uma linha para alternar.';
  for(const k in routeLayers){
    routeLayers[k].setStyle({weight:k===key?7:4,opacity:k===key?.95:.5});
  }
  if(nav.active&&nav.lastFix)navLocationUpdate(nav.lastFix);
}
const previousRouteResult=window.onRouteResult;
window.onRouteResult=function(raw,avoid){
  const wasRerouting=nav.rerouting;
  previousRouteResult(raw,avoid);
  const key=avoid?'alternate':'common';
  try{
    nav.routes[key]=navParse(raw);
    if(routeLayers[key]){
      routeLayers[key].on('click',e=>{
        if(e.originalEvent)L.DomEvent.stopPropagation(e.originalEvent);
        navSelect(key);
        if(nav.active)setStatus('Você alterou a rota em acompanhamento.');
      });
    }
    navSelect(key);
    if(wasRerouting){
      nav.rerouting=false;
      nav.offRouteCount=0;
      nav.follow=true;
      if(nav.active){
        if(nav.lastFix)navLocationUpdate(nav.lastFix);
        navSpeak('Rota recalculada.');
        setStatus('Nova rota calculada. Continue pelas instruções.');
      }
    }
  }catch(e){
    if(wasRerouting)nav.rerouting=false;
    setStatus('Não foi possível preparar instruções de navegação: '+e.message);
  }
};
const previousRouteError=window.onRouteError;
window.onRouteError=function(message){
  previousRouteError(message);
  if(nav.rerouting){
    nav.rerouting=false;
    nav.offRouteCount=0;
    setStatus('Não foi possível recalcular a rota. Acompanhe o mapa ou encerre a navegação.');
  }
};
function navClearRoutes(){
  nav.routes={};nav.selected=null;
  navEl('navStartBtn').disabled=true;
  navEl('navSelection').textContent='Calcule uma rota para começar a navegar.';
}
const previousClearSelection=clearSelection;
clearSelection=function(){
  if(nav.active)stopNavigation();
  previousClearSelection();
  navClearRoutes();
};
const previousSetPoint=setPoint;
setPoint=function(field,p,label){
  if(nav.active)stopNavigation();
  previousSetPoint(field,p,label);
  navClearRoutes();
};
for(const field of ['origin','destination']){
  inputFor(field).addEventListener('input',()=>{
    if(nav.active)stopNavigation();
    navClearRoutes();
  });
}
function startNavigation(){
  if(nav.active)return;
  if(!nav.routes[nav.selected]){
    setStatus('Calcule uma rota antes de iniciar a navegação.');return;
  }
  if(!window.RodizioAndroid?.iniciarNavegacao){
    setStatus('Esta versão do aplicativo não oferece GPS de navegação.');return;
  }
  nav.pending=true;
  setStatus('Iniciando GPS contínuo e orientação por voz...');
  RodizioAndroid.iniciarNavegacao();
}
window.onNavigationStarted=function(){
  if(!nav.pending)return;
  nav.pending=false;nav.active=true;nav.follow=true;
  nav.heading=null;nav.headingSource=null;
  nav.progressed=false;nav.progress=0;nav.begunAt=Date.now();
  nav.offRouteCount=0;nav.announcements.clear();
  nav.radarNotified.clear();nav.lastRadarVoice=0;
  navPrepareRadarWarnings();
  document.body.classList.add('navigating');
  navEl('navHud').hidden=false;
  navEl('navMetrics').hidden=false;
  navEl('navStartBtn').hidden=true;
  for(const id of ['navStopBtn','navCenterBtn','navSoundBtn','mapHeadingBtn'])navEl(id).hidden=false;
  navEl('mapHeadingBtn').textContent=nav.headingMode?'Rumo ↑':'Norte ↑';
  navEl('navNext').textContent='Siga pela rota destacada';
  navEl('navTurnDist').textContent='Aguardando posição GPS...';
  navEl('navLeft').textContent=navMeters(nav.routes[nav.selected].length);
  navEl('navEta').textContent=navTime(nav.routes[nav.selected].totalSeconds||60);
  navEl('navAccuracy').textContent='—';
  map.invalidateSize();
  setStatus('Navegação ativa. Mantenha a tela aberta; o mapa segue sua posição.');
  navSpeak('Navegação iniciada. Siga a rota destacada.');
};
function stopNavigation(){
  if(!nav.active&&!nav.pending)return;
  nav.active=false;nav.pending=false;nav.rerouting=false;
  document.body.classList.remove('navigating');
  if(typeof map.stopHeadingUp==='function')map.stopHeadingUp();
  if(typeof map.setBearing==='function')map.setBearing(0);
  nav.heading=null;nav.headingSource=null;
  navEl('navHud').hidden=true;
  navEl('navMetrics').hidden=true;
  navEl('navStartBtn').hidden=false;
  for(const id of ['navStopBtn','navCenterBtn','navSoundBtn','mapHeadingBtn'])navEl(id).hidden=true;
  if(window.RodizioAndroid?.pararNavegacao)RodizioAndroid.pararNavegacao();
  map.invalidateSize();
  setStatus('Navegação encerrada. Você pode selecionar outra rota.');
}
function navCenterAt(point){
  if(!point)return;
  const zoom=Math.max(16,map.getZoom());
  map.setView(point,zoom,{animate:false});
  navOffsetViewport(point);
}
function navOffsetViewport(point){
  if(!point)return;
  const size=map.getSize();
  const screen=map.latLngToContainerPoint(point);
  const target=L.point(size.x*.5,size.y*.74);
  const dx=screen.x-target.x,dy=screen.y-target.y;
  if(Math.abs(dx)>4||Math.abs(dy)>4)
    map.panBy([dx,dy],{animate:false});
}
function centerNavigation(){
  nav.follow=true;
  if(nav.lastFix)navCenterAt(nav.lastFix.point);
}
function toggleNavigationHeading(){
  nav.headingMode=!nav.headingMode;
  navEl('mapHeadingBtn').textContent=nav.headingMode?'Rumo ↑':'Norte ↑';
  if(nav.headingMode){
    nav.heading=null;nav.headingSource=null;
    if(nav.lastFix&&nav.routes[nav.selected])navLocationUpdate(nav.lastFix);
  }else if(typeof map.stopHeadingUp==='function'){
    map.stopHeadingUp();
    map.setBearing(0);
    if(nav.lastFix&&nav.follow)navCenterAt(nav.lastFix.point);
  }
}
function toggleNavigationSound(){
  nav.sound=!nav.sound;
  navEl('navSoundBtn').textContent=nav.sound?'Voz: ligada':'Voz: desligada';
  if(nav.sound)navSpeak('Orientação por voz ativada.');
}
function navSpeak(message){
  if(!nav.sound||!nav.active)return;
  nav.lastVoice=Date.now();
  if(window.RodizioAndroid?.falar)RodizioAndroid.falar(message);
}
window.onNavigationError=function(message){
  if(nav.pending)nav.pending=false;
  if(nav.active){
    setStatus('GPS: '+message);
  }else setStatus(message);
};
function navClosest(route,p){
  const latRad=p[0]*Math.PI/180;
  const xScale=111320*Math.cos(latRad),yScale=110960;
  let best=null,score=Infinity;
  for(let i=0;i<route.coords.length-1;i++){
    const a=route.coords[i],b=route.coords[i+1];
    const ax=(a[1]-p[1])*xScale,ay=(a[0]-p[0])*yScale;
    const bx=(b[1]-p[1])*xScale,by=(b[0]-p[0])*yScale;
    const vx=bx-ax,vy=by-ay;
    const mag=vx*vx+vy*vy;
    const t=mag>0?Math.max(0,Math.min(1,-(ax*vx+ay*vy)/mag)):0;
    const dx=ax+vx*t,dy=ay+vy*t,dist=Math.hypot(dx,dy);
    const along=route.cumulative[i]+t*(route.cumulative[i+1]-route.cumulative[i]);
    // Reduz saltos para ruas próximas e sobrepostas, sem impedir retorno ao percurso.
    const penalty=nav.progressed?Math.max(0,nav.progress-along-35)*.6+
       Math.max(0,along-nav.progress-450)*.17:0;
    const quality=dist+penalty;
    if(quality<score){
      score=quality;best={distance:dist,progress:along,point:[
        a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])
      ]};
    }
  }
  return best;
}
function navPrepareRadarWarnings(){
  const route=nav.routes[nav.selected];
  if(!route)return;
  // Recalcula somente após obter nova rota ou nova lista.
  route.radarTargets=[];
  if(!Array.isArray(RADARES))return;
  let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
  for(const p of route.coords){
    minLat=Math.min(minLat,p[0]);maxLat=Math.max(maxLat,p[0]);
    minLon=Math.min(minLon,p[1]);maxLon=Math.max(maxLon,p[1]);
  }
  minLat-=.00065;maxLat+=.00065;minLon-=.00075;maxLon+=.00075;
  for(let j=0;j<RADARES.length;j++){
    const camera=RADARES[j];
    if(camera[0]<minLat||camera[0]>maxLat||camera[1]<minLon||camera[1]>maxLon)continue;
    const latRad=camera[0]*Math.PI/180;
    const xs=111320*Math.cos(latRad),ys=110960;
    let best=Infinity,at=0;
    for(let i=0;i<route.coords.length-1;i++){
      const a=route.coords[i],b=route.coords[i+1];
      if(Math.abs(a[0]-camera[0])>.003&&Math.abs(b[0]-camera[0])>.003)continue;
      const ax=(a[1]-camera[1])*xs,ay=(a[0]-camera[0])*ys;
      const bx=(b[1]-camera[1])*xs,by=(b[0]-camera[0])*ys;
      const vx=bx-ax,vy=by-ay,d2=vx*vx+vy*vy;
      const t=d2?Math.max(0,Math.min(1,-(ax*vx+ay*vy)/d2)):0;
      const dist=Math.hypot(ax+vx*t,ay+vy*t);
      if(dist<best){
        best=dist;
        at=route.cumulative[i]+t*(route.cumulative[i+1]-route.cumulative[i]);
      }
    }
    if(best<=42)route.radarTargets.push({id:j,at,distanceToRoad:best});
  }
  route.radarTargets.sort((a,b)=>a.at-b.at);
}
function navRadarVoiceUpdate(route,fix){
  if(!nav.active||!nav.sound||fix.accuracy>55||nav.rerouting)return;
  if(Date.now()-nav.lastRadarVoice<7500||Date.now()-nav.lastVoice<2400)return;
  if(!route.radarTargets)return;
  // Prioridade das conversões quando uma manobra estiver muito próxima.
  const imminentTurn=route.hints.some(h=>{
    const left=route.cumulative[h.index]-nav.progress;
    return left>=0&&left<95&&h.cmd!==1;
  });
  if(imminentTurn)return;
  const radar=route.radarTargets.find(c=>
    !nav.radarNotified.has(c.id)&&c.at>nav.progress+12&&c.at<=nav.progress+305);
  if(!radar)return;
  const d=Math.max(20,radar.at-nav.progress);
  nav.radarNotified.add(radar.id);
  // Agrupa outras câmeras no mesmo trecho para não repetir o aviso.
  for(const camera of route.radarTargets){
    if(Math.abs(camera.at-radar.at)<90)nav.radarNotified.add(camera.id);
  }
  const spoken=d>200?300:d>125?200:d>65?100:Math.round(d/20)*20;
  nav.lastRadarVoice=Date.now();
  const message='Atenção, câmera de fiscalização cadastrada a aproximadamente '+spoken+' metros à frente.';
  if(window.RodizioAndroid?.falarRadar)RodizioAndroid.falarRadar(message);
  else navSpeak(message);
}
function navAngleDelta(from,to){
  return ((to-from+540)%360)-180;
}
function navBearing(a,b){
  const dLat=(b[0]-a[0])*Math.PI/180;
  const dLon=(b[1]-a[1])*Math.PI/180;
  const latitude=((a[0]+b[0])/2)*Math.PI/180;
  const degrees=Math.atan2(dLon*Math.cos(latitude),dLat)*180/Math.PI;
  return (degrees+360)%360;
}
function navAlongPoint(route,meters){
  const d=Math.max(0,Math.min(route.length,meters));
  let lo=0,hi=route.cumulative.length-1;
  while(lo+1<hi){
    const m=(lo+hi)>>1;
    if(route.cumulative[m]<=d)lo=m;else hi=m;
  }
  const a=route.cumulative[lo],b=route.cumulative[lo+1];
  const t=b>a?(d-a)/(b-a):0;
  const p=route.coords[lo],q=route.coords[lo+1];
  return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
}
function navRouteBearing(route,progress){
  if(route.length<10)return null;
  const a=Math.max(0,progress-8),b=Math.min(route.length,progress+47);
  if(b-a<5)return null;
  return navBearing(navAlongPoint(route,a),navAlongPoint(route,b));
}
function navUpdateHeading(loc,route,match){
  if(!nav.headingMode||typeof map.setHeading!=='function')return;
  if(loc.accuracy>65)return;
  const goodGPS=loc.speed>=2.8&&loc.accuracy<=40&&
    Number.isFinite(loc.bearing)&&loc.bearing>=0&&loc.bearing<360;
  const routeBearing=navRouteBearing(route,match.progress);
  let desired=null;
  if(goodGPS){
    // Course-over-ground só tem prioridade em movimento e com GPS razoável.
    desired=loc.bearing;
    nav.headingSource='GPS';
  }else if((nav.heading===null||loc.speed>=1.4)&&routeBearing!==null&&match.distance<65){
    // Em baixa velocidade, segue o sentido da geometria do percurso.
    desired=routeBearing;
    nav.headingSource='rota';
  }
  if(desired===null)return;
  if(nav.heading===null){
    nav.heading=desired;
  }else{
    const delta=navAngleDelta(nav.heading,desired);
    if(Math.abs(delta)<5)return;
    const maxStep=goodGPS?32:23;
    const step=Math.max(-maxStep,Math.min(maxStep,delta*.65));
    nav.heading=(nav.heading+step+360)%360;
  }
  map.setHeading(nav.heading,{ease:.24,deadzone:.5});
}
function navArrow(loc){
  const forward=nav.heading!==null?nav.heading:(Number.isFinite(loc.bearing)&&loc.bearing>=0?loc.bearing:0);
  const rotation=nav.headingMode?-90:forward-90;
  const icon=L.divIcon({
    className:'',iconSize:[28,28],iconAnchor:[14,14],
    html:'<div class="nav-point"><span class="nav-arrow" style="transform:rotate('+rotation.toFixed(1)+'deg)">➤</span></div>'
  });
  if(!nav.marker)nav.marker=L.marker(loc.point,{icon,zIndexOffset:1000}).addTo(map);
  else{nav.marker.setLatLng(loc.point);nav.marker.setIcon(icon);}
  if(!nav.circle)nav.circle=L.circle(loc.point,{radius:Math.max(5,loc.accuracy),color:'#2476c4',weight:1,fillColor:'#74b8ed',fillOpacity:.1,interactive:false}).addTo(map);
  else{nav.circle.setLatLng(loc.point);nav.circle.setRadius(Math.max(5,loc.accuracy));}
}
function navLocationUpdate(loc){
  if(!nav.active||!nav.routes[nav.selected])return;
  const route=nav.routes[nav.selected];
  const match=navClosest(route,loc.point);
  if(match&&!nav.rerouting)navUpdateHeading(loc,route,match);
  navArrow(loc);
  if(nav.follow)navCenterAt(loc.point);
  navEl('navAccuracy').textContent=Math.round(loc.accuracy)+' m';
  if(loc.accuracy>95){
    navEl('navTurnDist').textContent='Aguardando GPS com melhor precisão';
    return;
  }
  if(!match)return;
  if(match.distance>Math.max(85,2*loc.accuracy)){
    nav.offRouteCount++;
    navEl('navTurnDist').textContent='Você está fora do trajeto planejado';
    if(nav.offRouteCount>=3&&Date.now()-nav.begunAt>12000&&
       Date.now()-nav.lastReroute>25000&&!nav.rerouting&&loc.accuracy<=60){
      navReroute(loc.point);
    }
    return;
  }
  nav.offRouteCount=0;
  if(!nav.progressed){
    nav.progress=match.progress;
    nav.progressed=true;
  }else{
    // Tolerância de 30 m para oscilação do GPS sem retroceder os avisos.
    nav.progress=Math.max(nav.progress-30,match.progress);
  }
  const left=Math.max(0,route.length-nav.progress);
  navEl('navLeft').textContent=navMeters(left);
  const eta=route.totalSeconds>0?route.totalSeconds*left/Math.max(1,route.length):0;
  navEl('navEta').textContent=eta>0?navTime(eta):'—';
  const turn=route.hints.find(h=>route.cumulative[h.index]>=nav.progress-22);
  if(turn){
    const meters=Math.max(0,route.cumulative[turn.index]-nav.progress);
    const label=navTurnText(turn.cmd,turn.exit);
    navEl('navNext').textContent=label;
    navEl('navTurnDist').textContent='Em '+navMeters(meters);
    navAnnounceTurn(turn,label,meters,loc.accuracy);
  }else{
    navEl('navNext').textContent='Siga até seu destino';
    navEl('navTurnDist').textContent=navMeters(left)+' restantes';
  }
  navRadarVoiceUpdate(route,loc);
  if(left<35&&km(loc.point,destination)*1000<55){
    stopNavigation();
    setStatus('Você chegou ao destino.');
    if(nav.sound&&window.RodizioAndroid?.falar){
      setTimeout(()=>RodizioAndroid.falar('Você chegou ao destino.'),100);
    }
  }
}
function navAnnounceTurn(h,label,meters,accuracy){
  if(accuracy>65)return;
  const key=h.index+':'+h.cmd;
  if(meters<=70&&!nav.announcements.has(key+':now')){
    nav.announcements.add(key+':now');nav.announcements.add(key+':near');
    navSpeak('Agora, '+label.toLowerCase()+'.');
  }else if(meters<=360&&!nav.announcements.has(key+':near')){
    nav.announcements.add(key+':near');
    const rounded=meters>200?Math.round(meters/50)*50:Math.round(meters/20)*20;
    navSpeak('Em '+rounded+' metros, '+label.toLowerCase()+'.');
  }
}
function navReroute(point){
  if(!destination||!nav.routes[nav.selected])return;
  nav.rerouting=true;nav.lastReroute=Date.now();nav.offRouteCount=0;
  setStatus('Saída da rota detectada. Recalculando pelo BRouter offline...');
  navSpeak('Você saiu do trajeto. Recalculando a rota.');
  origin=point.slice();
  if(originMark)originMark.setLatLng(origin);
  else originMark=makeMark(origin,'#2164aa');
  inputFor('origin').value='Localização atual';
  // Esta chamada usa o cálculo normal, preservando a opção de evitar radares.
  calculate(nav.selected==='alternate');
}
window.onNavigationLocation=function(lat,lon,accuracy,bearing,speed){
  if(!nav.active)return;
  const values=[lat,lon,accuracy,bearing,speed].map(Number);
  if(!Number.isFinite(values[0])||!Number.isFinite(values[1]))return;
  if(Math.abs(values[0])>90||Math.abs(values[1])>180)return;
  const point=[values[0],values[1]];
  nav.lastFix={
    point,
    accuracy:Number.isFinite(values[2])&&values[2]>=0?values[2]:150,
    bearing:Number.isFinite(values[3])?values[3]:-1,
    speed:Number.isFinite(values[4])?values[4]:-1
  };
  navLocationUpdate(nav.lastFix);
};
map.on('dragstart',()=>{
  if(nav.active)nav.follow=false;
});

// O plugin de rotação reancora o centro durante o giro: preservamos o carro
// na região inferior do mapa para dar visibilidade às ruas adiante.
map.on('rotate',()=>{
  if(nav.active&&nav.follow&&nav.lastFix)navOffsetViewport(nav.lastFix.point);
});
