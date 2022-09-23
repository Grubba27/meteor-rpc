import { insert, remove, setChecked } from "./mutations";


remove.addBeforeResolveHook((raw, parsed) => {
  console.log(parsed, 'email')
})

insert.addAfterResolveHook((raw, parsed, result) => {
  console.log(parsed, 'email')
})

setChecked.addErrorResolveHook((raw, parsed, error) => {
  console.log(error, 'email')
})
