const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const PORT=process.env.PORT||3000;
const rooms=new Map();
const cards={
 roulette:{type:'attack',icon:'🔫',name:'ロシアンルーレット',damage:4,desc:'4ダメージ。1/6で命中。'},
 doubleEdge:{type:'attack',icon:'⚔️',name:'諸刃',damage:2,desc:'1ダメージ×2。'},
 atomic:{type:'attack',icon:'💣',name:'アトミック',damage:3,desc:'3ダメージ。'},
 kaiser:{type:'attack',icon:'👑',name:'カイザー',damage:2,desc:'2ダメージ＋追加攻撃。'},
 burst:{type:'attack',icon:'🔥',name:'バースト',damage:3,desc:'3ダメージ。次の自分の攻撃をスキップ。'},
 sundial:{type:'attack',icon:'☀️',name:'日時計',damage:2,desc:'2ダメージ。防御無視。月時計とは特殊衝突。'},
 diamond:{type:'defense',icon:'💎',name:'ダイヤモンド',desc:'最終ダメージを反射。'},
 moon:{type:'defense',icon:'🌙',name:'月時計',desc:'攻撃無効。日時計とはタイムパラドックス。'},
 white:{type:'defense',icon:'🏳️',name:'白旗',desc:'ダメージ0＋チップ1個。'},
 guard:{type:'defense',icon:'🧱',name:'ガード',desc:'ダメージを2軽減。'},
 invert:{type:'defense',icon:'🌀',name:'反転',desc:'半分反射、残りを受ける。'},
 seal:{type:'defense',icon:'🔮',name:'封印',desc:'攻撃の追加効果を無効化。ダメージは通す。'},
 mirror:{type:'defense',icon:'🪞',name:'ミラー',desc:'最終ダメージを両者が同じだけ受ける。'}
};
const all=Object.keys(cards);
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function newPlayer(){return {hp:7,hand:[],chips:[],skip:false}}
function newGame(){
 const deck=shuffle(all.flatMap(k=>[k,k]));
 const p=[newPlayer(),newPlayer()];
 for(let i=0;i<6;i++){p[0].hand.push(deck.pop());p[1].hand.push(deck.pop())}
 return {deck,discard:[],p,turn:0,phase:'attack',attackCard:null,defenseCard:null,attackChip:null,gameOver:false,log:['ゲーム開始。先攻はPlayer 1です。'],version:1}
}
function roomCode(){return Math.random().toString(36).slice(2,8).toUpperCase()}
function token(){return crypto.randomBytes(18).toString('hex')}
function addCard(g,i){if(!g.deck.length){g.deck=shuffle(g.discard);g.discard=[]}if(g.deck.length)g.p[i].hand.push(g.deck.pop())}
function drawEnd(g){addCard(g,0);addCard(g,1)}
function hasType(p,type){return p.hand.some(k=>cards[k].type===type)}
function takeCard(p,key){const i=p.hand.indexOf(key);if(i<0)return false;p.hand.splice(i,1);return true}
function addLog(g,s){g.log.push(s);if(g.log.length>40)g.log.shift()}
function chip(p,type){const i=p.chips.indexOf(type);if(i<0)return false;p.chips.splice(i,1);return true}
function gainChip(p){p.chips.push(Math.random()<.5?'sure':'double')}
function damage(g,i,n){n=Math.max(0,Math.floor(n));if(!n)return;g.p[i].hp=Math.max(0,g.p[i].hp-n);gainChip(g.p[i]);if(g.p[i].hp<=0)g.gameOver=true}
function resolve(g,a,d,chipUsed){
 const A=g.p[a],D=g.p[d];
 const attack=g.attackCard,defense=g.defenseCard;
 const effectCanceled=defense==='seal';
 const extra=attack==='kaiser'&&!effectCanceled;
 if(attack==='roulette'){
   const hit=chipUsed==='sure'||Math.floor(Math.random()*6)===0;
   if(!hit){addLog(g,'🔫 ロシアンルーレット…不発！');return {extra};}
   addLog(g,'🔫 BANG! ロシアンルーレット命中！');
 }
 // ☀️×🌙 is a complete special route: both take 0 and normal damage processing stops.
 if(attack==='sundial'&&defense==='moon'){
   [A.hand,D.hand]=[D.hand,A.hand];
   addLog(g,'⏳ TIME PARADOX — 両者の手札が入れ替わった。ダメージ0。');
   return {extra};
 }
 // Defense-ignoring Sundial bypasses every defense except the special Moon Clock collision above.
 if(attack==='sundial'){
   if(!effectCanceled) addLog(g,'☀️ DEFENSE BREAK — 日時計が防御を無視！');
 }
 let base=cards[attack].damage||0;
 if(attack==='roulette' && !g.log[g.log.length-1].includes('BANG!')) return {extra};
 if(chipUsed==='double')base*=2;
 if(!effectCanceled&&attack==='burst'){A.skip=true;addLog(g,'🔥 バースト：次の自分の攻撃をスキップ。')}
 if(!effectCanceled&&attack==='kaiser')addLog(g,'👑 ADDITIONAL ATTACK — カイザーの追加攻撃！');
 // Sundial ignores defense, but Moon Clock was already handled above.
 if(attack==='sundial'){
   damage(g,d,base);addLog(g,`💥 ${base}ダメージ！`);return {extra};
 }
 if(defense==='moon'){addLog(g,'🌙 月時計：攻撃を無効化。');return {extra};}
 if(defense==='white'){gainChip(D);addLog(g,'🏳️ 白旗：ダメージ0。チップ+1。');return {extra};}
 if(defense==='seal')addLog(g,'🔮 EFFECT CANCEL — 追加効果を封印。');
 if(defense==='diamond'){
   // Reflect the FINAL attack damage, including chips and multi-hit total.
   damage(g,a,base);addLog(g,`💎 COUNTER — ${base}ダメージ反射！`);return {extra};
 }
 if(defense==='guard')base=Math.max(0,base-2);
 if(defense==='invert'){
   const reflected=Math.floor(base/2),taken=base-reflected;
   damage(g,a,reflected);damage(g,d,taken);addLog(g,`🌀 反転：${reflected}反射 / ${taken}被弾。`);return {extra};
 }
 if(defense==='mirror'){
   damage(g,d,base);damage(g,a,base);addLog(g,`🪞 ミラー：両者 ${base}ダメージ。`);return {extra};
 }
 if(attack==='doubleEdge'){
   // base is the total final damage (1×2, or 2×2 with Double chip).
   damage(g,d,base);addLog(g,`⚔️ 諸刃：${base/2}×2。`);return {extra};
 }
 damage(g,d,base);addLog(g,`💥 ${base}ダメージ！`);return {extra};
}
function publicState(g,me){
 const other=me===0?1:0;
 return {room:null,me,players:[{hp:g.p[me].hp,hand:g.p[me].hand,chips:g.p[me].chips,skip:g.p[me].skip},{hp:g.p[other].hp,handCount:g.p[other].hand.length,chips:g.p[other].chips.length}],turn:g.turn,phase:g.phase,attackCard:g.attackCard,defenseCard:g.defenseCard,gameOver:g.gameOver,log:g.log,version:g.version,playersReady:g.playersTokens?.length||0}
}
function send(res,obj,status=200){const b=Buffer.from(JSON.stringify(obj));res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':b.length});res.end(b)}
function body(req){return new Promise((ok,fail)=>{let s='';req.on('data',c=>s+=c);req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){fail(e)}})})}
function serve(req,res){
  let u=new URL(req.url,'http://x');
  let file=u.pathname==='/'?'/index.html':u.pathname;
  let p=path.join(__dirname,file);
  if(!p.startsWith(__dirname))return send(res,{error:'bad path'},403);
  fs.readFile(p,(e,b)=>{
    if(e)return send(res,{error:'not found'},404);
    let ext=path.extname(p);
    let ct=ext==='.html'?'text/html; charset=utf-8':
           ext==='.json'?'application/json; charset=utf-8':
           'application/octet-stream';
    res.writeHead(200,{'Content-Type':ct});
    res.end(b);
  });
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url.startsWith('/api/')){
   const u=new URL(req.url,'http://x');
   if(req.method==='POST'&&u.pathname==='/api/create'){
    const code=roomCode();const t=token();const g=newGame();g.playersTokens=[t];rooms.set(code,g);return send(res,{code,token:t,player:0,state:publicState(g,0)})
   }
   if(req.method==='POST'&&u.pathname==='/api/join'){
    const x=await body(req);const code=String(x.code||'').toUpperCase();const g=rooms.get(code);if(!g)return send(res,{error:'部屋が見つかりません'},404);if(g.playersTokens.length>=2)return send(res,{error:'この部屋は満員です'},409);const t=token();g.playersTokens.push(t);addLog(g,'Player 2が参加しました。');g.version++;return send(res,{code,token:t,player:1,state:publicState(g,1)})
   }
   if(req.method==='GET'&&u.pathname==='/api/state'){
    const code=u.searchParams.get('code'),t=u.searchParams.get('token'),g=rooms.get(code);if(!g)return send(res,{error:'部屋が見つかりません'},404);const me=g.playersTokens.indexOf(t);if(me<0)return send(res,{error:'認証エラー'},403);return send(res,publicState(g,me))
   }
   if(req.method==='POST'&&u.pathname==='/api/action'){
    const x=await body(req),code=x.code,t=x.token,g=rooms.get(code);if(!g)return send(res,{error:'部屋が見つかりません'},404);const me=g.playersTokens.indexOf(t);if(me<0)return send(res,{error:'認証エラー'},403);if(g.gameOver)return send(res,{error:'ゲーム終了'},409);if(g.playersTokens.length<2)return send(res,{error:'相手の参加待ちです'},409);if(me!==g.turn)return send(res,{error:'相手のターンです'},409);
    const p=g.p[me];
    if(g.phase==='attack'){
      // No attack card, or Burst's skipped attack: end automatically.
      if(p.skip){p.skip=false;addLog(g,`Player ${me+1}は次の攻撃をスキップ。`);drawEnd(g);g.turn=1-me;g.phase='attack';g.attackCard=null;g.defenseCard=null;g.attackChip=null;g.version++;return send(res,{ok:true,state:publicState(g,me)})}
      if(!hasType(p,'attack')){addLog(g,`Player ${me+1}に攻撃カードがないため自動終了。`);drawEnd(g);g.turn=1-me;g.phase='attack';g.attackCard=null;g.defenseCard=null;g.attackChip=null;g.version++;return send(res,{ok:true,state:publicState(g,me)})}
      if(!x.card||!cards[x.card]||cards[x.card].type!=='attack'||!takeCard(p,x.card))return send(res,{error:'攻撃カードを選んでください'},400);
      g.attackCard=x.card;g.attackChip=null;
      if(x.chip){if(x.card!=='roulette')return send(res,{error:'必中/一石二鳥はロシアンルーレット専用です'},400);if(!['sure','double'].includes(x.chip)||!chip(p,x.chip))return send(res,{error:'そのチップはありません'},400);g.attackChip=x.chip}
      g.phase='defense';g.version++;return send(res,{ok:true,state:publicState(g,me)})
    }
    if(g.phase==='defense'){
      // No defense card: attack goes through automatically.
      if(!hasType(p,'defense')){
        g.defenseCard=null;
        const r=resolve(g,g.turn,1-g.turn,g.attackChip);const attacker=g.turn;
        if(g.gameOver){g.version++;return send(res,{ok:true,state:publicState(g,me)})}
        drawEnd(g);g.attackCard=null;g.defenseCard=null;g.attackChip=null;g.turn=r.extra?attacker:1-attacker;g.phase='attack';g.version++;return send(res,{ok:true,state:publicState(g,me)})
      }
      if(x.card&&!cards[x.card])return send(res,{error:'不正なカード'},400);
      if(x.card&&cards[x.card].type!=='defense')return send(res,{error:'防御カードを選んでください'},400);
      if(x.card&&!takeCard(p,x.card))return send(res,{error:'その防御カードはありません'},400);
      g.defenseCard=x.card||null;
      const r=resolve(g,g.turn,1-g.turn,g.attackChip);const attacker=g.turn;
      if(g.gameOver){g.version++;return send(res,{ok:true,state:publicState(g,me)})}
      drawEnd(g);g.attackCard=null;g.defenseCard=null;g.attackChip=null;g.turn=r.extra?attacker:1-attacker;g.phase='attack';g.version++;return send(res,{ok:true,state:publicState(g,me)})
    }
   }
   return send(res,{error:'not found'},404)
  }
  serve(req,res)
 }catch(e){console.error(e);send(res,{error:'server error'},500)}
});
server.listen(PORT,()=>console.log(`BLACKOUT online on ${PORT}`));
