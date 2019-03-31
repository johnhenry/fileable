import template from '/Users/johnhenry/Sync/fileable/test/example/template.jsx';
import {renderFS as render} from "../../dist/lib/index.js";
import args from "/Users/johnhenry/Sync/fileable/test/example/input.js";
const main = async()=>{
const input = [];
for await(const arg of args){
    input.push(arg);
}

render(await template(... input), {folder_context:['/Users/johnhenry/Sync/fileable/dist/temp'], template_context:'/Users/johnhenry/Sync/fileable/test/example'});
}
main();
// 