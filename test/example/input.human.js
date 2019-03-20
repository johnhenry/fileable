import { prompt, alert } from 'node-popup';
const inputs = async function* () {
    const name = await prompt('What\'s your name?', 'John');
    yield name;
}
export default inputs();
