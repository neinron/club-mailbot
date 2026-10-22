import {readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
export async function journalProgress(directory,{campaign,total}) {
 let files=[];try{files=await readdir(directory)}catch(error){if(error.code!=='ENOENT')throw error;}
 const events=await Promise.all(files.filter(f=>/^[a-f0-9-]+\.json$/.test(f)).map(async f=>JSON.parse(await readFile(join(directory,f),'utf8'))));
 const relevant=events.filter(e=>e.campaign===campaign);
 const sent=relevant.filter(e=>e.status==='Sent').length,failed=relevant.filter(e=>e.status==='Failed').length,unknown=relevant.filter(e=>e.status==='Unknown').length;
 const lastActivity=relevant.map(e=>e.at).sort().at(-1)||null;
 return {campaign,total,sent,failed,unknown,skipped:0,processed:sent+failed,state:sent+failed>=total?'finished':'observing',lastActivity,updatedAt:new Date().toISOString()};
}
export async function writeProgress(file,progress){const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(progress));await rename(tmp,file);}
