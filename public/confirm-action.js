export function confirmAction({title,description,label='Delete'}) {
  const dialog=document.querySelector('#actionConfirmation');
  if(dialog.open)return Promise.resolve(false);
  dialog.querySelector('h3').textContent=title;
  dialog.querySelector('p').textContent=description;
  dialog.querySelector('[value="confirm"]').textContent=label;
  dialog.returnValue='';
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});
    dialog.showModal();
  });
}
