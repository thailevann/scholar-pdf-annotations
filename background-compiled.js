(function(){

// =======================
// 1. Storage wrapper
// =======================
class m {
  get(a,b){ chrome.storage.local.get(a,c=>{b(chrome.runtime.lastError?null:c)}) } // Lấy key từ storage
  set(a){ chrome.storage.local.set(a,function(){}) } // Lưu key vào storage
  remove(a){chrome.storage.local.remove(a)} // Xóa key khỏi storage
}

// =======================
// 2. URL và domain patterns
// =======================
const n=chrome.runtime.getURL("reader.html"); // URL của reader.html trong extension
const p=/^scholar[.]google[.][^.]+([.][^.]+)?$/; // Regex check domain Scholar
const r="chrome-extension://"+chrome.runtime.id; // URL base extension
const t=[ // Các PDF viewer extension để check
  "chrome-extension://efaidnbmnnnibpcajpcglclefindmkaj/viewer.html",
  "chrome-extension://oemmndcbldboiebfnladdacbdfmadadm/content/web/viewer.html",
  "chrome-extension://ieepebpjnkhaiioojkepfniodjmjjihl/data/pdf.js/web/viewer.html"
];

// =======================
// 3. Helper lấy header value
// =======================
function u(a,b){
  if(!a) return "";
  for(const {name:c,value:d} of a)
    if(c && c.toLowerCase()===b) return d||"";
  return "";
}

// =======================
// 4. NetRequest/Rules management (complex, throttle updates)
// =======================
var v=function(a){ /* xử lý throttle các Map dữ liệu request PDF */ };
var z=function(a,b){ /* lấy hoặc khởi tạo object tracking tab+frame */ };
var A=function(a){ /* remove old declarativeNetRequest rules định kỳ */ };
var B=function(a,b){ /* Lấy thông tin PDF/URL/parent frame từ Map, trả về Promise */ };

// =======================
// 5. Class quản lý session rules
// =======================
class C{
  constructor(){
    this.i=new Map;
    this.g=new Map;
    this.j=new Map;
    this.h=new Map;
    const a=chrome.extension.inIncognitoContext;
    this.C=a?1E8:1; // rule id start: tab incognito khác thường
    this.m=this.o=false;
    // remove session rules cũ
    chrome.declarativeNetRequest.getSessionRules().then(b=>{
      const c=[];
      for(const d of b)
        (a&&d.id>=1E8||!a&&d.id<1E8)&&c.push(d.id);
      if(c.length>0) chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:c})
    })
  }
}
const w=new C;

// =======================
// 6. webRequest listener
// =======================
chrome.webRequest.onBeforeSendHeaders.addListener(a=>{
  // Thêm thông tin referrer cho request (chỉ tab >=0 và không xhr)
  if(!(a.tabId<0||a.type==="xmlhttprequest")){
    var b=u(a.requestHeaders,"referer"),c=a.url;
    z(a.tabId,a.frameId).F={url:c,referrer:b} // lưu vào Map
  }
},{urls:["<all_urls>"]},["requestHeaders","extraHeaders"]);

chrome.webRequest.onHeadersReceived.addListener(a=>{
  // Kiểm tra response headers, đặc biệt PDF
  if(a.tabId>=0 && a.type==="main_frame"){
    var b=a.url,c=a.statusCode,d=z(a.tabId,a.frameId);
    // handle redirect
    if(d.l && d.l.s){
      if(c<300||c>=400) d.l.s=false;
    } else c>=300&&c<400 ? d.l={s:true,G:b} : d.l=void 0;
  }

  // Nếu là PDF thì set rule headers referrer
  if(!(a.tabId<0 || a.type==="xmlhttprequest" || (a.initiator||"").startsWith("chrome-extension://") || u(a.responseHeaders,"content-type").split(";",1)[0].trim().toLowerCase()!=="application/pdf")){
    var c=a.tabId; d=a.url; b=w; a=`${c} ${a.frameId}`;
    var {F:e}=b.g.get(a)||b.i.get(a)||{};
    let g=(e?.referrer)||"";
    if((e?.url)!==d) g="";
    if(e=b.h.get(a)||b.j.get(a)) chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[e.ruleId]});
    e=b.C++;
    c=chrome.declarativeNetRequest.updateSessionRules({addRules:[{action:{requestHeaders:[{header:"referer",operation:"set",value:g}],type:"modifyHeaders"},condition:{initiatorDomains:[(new URL(d)).hostname],tabIds:[c],urlFilter:`|${d}|`},id:e}]})||Promise.resolve();
    b.h.set(a,{ruleId:e,promise:c}); A(b)
  }
},{urls:["<all_urls>"]},["responseHeaders"]);

// =======================
// 7. webNavigation listener
// =======================
chrome.webNavigation.onCommitted.addListener(a=>{
  if(a.url!==n){ // Nếu không phải reader.html
    var b=a.url;
    z(a.tabId,a.frameId).u=b; // lưu top URL
  } else { // reader.html
    b=a.tabId; var c=a.parentFrameId;
    z(b,a.frameId).D=`${b} ${c}`;
  }
});

// =======================
// 8. Local file access
// =======================
function D(a){ 
  // Mở cửa sổ nhỏ để cho phép access file PDF local
  chrome.windows.getCurrent(b=>{
    const c=Math.min(b.height,560),d=Math.min(b.width,650);
    chrome.windows.create({focused:true,left:Math.round(b.left+Math.max(0,(b.width-d)/2)),top:Math.round(b.top+Math.max(0,(b.height-c)/2)),height:c,width:d,url:"local_file_access.html#wid="+b.id,type:"normal"});
    b={}; b.fac=`${a+1}:${Date.now()}`;
    (new m).set(b)
  })
}

// Kiểm tra quyền file scheme, nếu không có, setup listener trước navigate
chrome.extension.isAllowedFileSchemeAccess(a=>{
  if(!a){
    chrome.webNavigation.onBeforeNavigate.addListener(function(){
      (new m).get(["fac"],b=>{
        b=((b||{}).fac||"").split(":");
        const c=Number(b[0])||0;
        b=(Number(b[1])||0)+12096E5*2**c;
        if(c<4 && Date.now()>=b) chrome.extension.isAllowedFileSchemeAccess(d=>d||D(c))
      })
    },{url:[{urlPrefix:"file://",pathSuffix:".pdf"},{urlPrefix:"file://",pathSuffix:".PDF"}]})
  }
});

// =======================
// 9. Fetch helper
// =======================
function E(a){ 
  // Chuyển message fetch từ content script sang fetch object
  const b={credentials:"include"};
  switch(a.method){
    case "GET": break;
    case "POST":
      if(typeof a.body!=="string") return null;
      b.method="POST"; b.body=a.body;
      break;
    default: return null;
  }
  if(typeof a.timeout==="number") b.signal=AbortSignal.timeout(a.timeout);
  return b;
}

// Check nếu domain là các publisher
function F(a){return[".proquest.com",".wiley.com",".ieee.org",".ebscohost.com"].find(b=>a.endsWith(b))}

// Kiểm tra frame PDF
function G(a,b){ return new Promise(c=>{ /* check tất cả frames, parentFrame, validate publisher domain */ }) }

// Kiểm tra history tab / top window
function H(a,b,c,d){ /* execute historyscript-compiled.js nếu cần */ }
function I(a,b,c,d){ /* get viewport width/height */ }
function J(a){ /* check referrer có phải scholar.google */ }

// =======================
// 10. Message handler từ content scripts
// =======================
chrome.runtime.onConnect.addListener(a=>{
  const b=a.sender,c=b.tab.id;
  if(b.id===chrome.runtime.id){
    var d=true;
    a.onMessage.addListener(e=>{
      if(b.tab && b.frameId!==void 0 && e && typeof e==="object")
        switch(e.type){
          case "getUrl": 
            B(b.tab.id,b.frameId).then(f=>{
              const k=f.v,l=f.A,x=f.B,L=f.parentFrameId;
              if(!k) console.error("Failed to get URL to load",b);
              const M=J(c); 
              G(k,c).then(q=>{
                const N=H(k,l,c,q),O=I(k,l,c,q);
                Promise.all([N,O,M]).then(([P,y,Q])=>{
                  d && a.postMessage({
                    pdfUrl:k,
                    topWindowUrlBeforeRedirects:x||l,
                    isScholarTopReferrer:Q,
                    isHistoryOnTopWindow:P,
                    shouldShowSignedInFeatures:q,
                    topWindowWidth:y.width,
                    topWindowHeight:y.height,
                    parentFrameId:L
                  })
                })
              })
            },f=>{console.error("Failed to get URL to load, reason:",f,b)});
            break;

          case "fetch":
            const g=e.url,h=e.id;
            if(typeof g==="string" && typeof h==="number" && (e=E(e))){
              fetch(g,e).then(f=>f.json()).then(f=>{
                d && a.postMessage({type:"fetch",id:h,json:f})
              }).catch(f=>{
                d && a.postMessage({type:"fetch",id:h,error:f.message})
              })
            }
            break;
        }
    });
    a.onDisconnect.addListener(()=>{d=false})
  }
});

// =======================
// 11. Offscreen document for clipboard / PDF handling
// =======================
let K=null;
async function R(){ 
  // tạo offscreen.html để copy text ra clipboard
  const a=chrome.runtime.getURL("offscreen.html");
  if((await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[a]})).length>0) return Promise.resolve();
  if(K) await K;
  else {
    K=chrome.offscreen.createDocument({url:"offscreen.html",reasons:[chrome.offscreen.Reason.CLIPBOARD],justification:"Write text to the clipboard."});
    await K; K=null;
  }
}
async function S(a,b){
  await R();
  chrome.runtime.sendMessage({type:"offscreen-copy",text:a,timestamp:b});
}

// =======================
// 12. OnInstalled event
// =======================
async function T(){
  for(const a of t) try{ return await fetch(a), true } catch(b){} return false;
}
chrome.runtime.onInstalled.addListener(a=>{
  if(a.reason===chrome.runtime.OnInstalledReason.INSTALL)
    T().then(b=>{ if(b) chrome.tabs.create({url:"https://scholar.google.com/scholar/reader-install.pdf"}) })
});

}).call(this);
