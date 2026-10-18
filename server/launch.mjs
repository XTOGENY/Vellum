import {spawn} from 'node:child_process';
import {createApp} from './index.mjs';
const url='http://127.0.0.1:8780/';
function openBrowser(){if(process.env.NWENAI_NO_BROWSER==='1')return;const command=process.platform==='win32'?'cmd.exe':process.platform==='darwin'?'open':'xdg-open';const args=process.platform==='win32'?['/c','start','',url]:[url];const child=spawn(command,args,{windowsHide:true,stdio:'ignore'});child.on('error',()=>console.log('请在浏览器打开 '+url));child.unref();}
let alreadyRunning=false;
try{const r=await fetch(url,{signal:AbortSignal.timeout(1200)});alreadyRunning=r.ok&&(await r.text()).match(/<title>(?:Vellum|NWENAI)/);}catch{}
if(alreadyRunning){console.log('Vellum 已在运行：'+url);openBrowser();}else{const {app}=await createApp();const server=app.listen(8780,'127.0.0.1',()=>{console.log('Vellum 工作台：'+url);openBrowser();});server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'8780 端口已被其他程序占用，请先释放该端口。':error.message);process.exitCode=1;});}
