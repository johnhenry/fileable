import { prompt, alert } from 'node-popup';
const inputs = async function* () {
    const name = await prompt('name?', 'john');
    yield name;
    alert(`check for dist/temp/${name}'s folder`);
}
export default inputs();
