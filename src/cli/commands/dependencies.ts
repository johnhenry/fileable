export const command = 'dependencies';
export const describe = 'List dependencies';
export const builder = {};
export const handler = async () => {
    const { dependencies } = require('../../package.json');
    for (const [name, version] of Object.entries(dependencies)) {
        console.log(`${name}: ${version}`);
    }
};
