export const command = 'template <path>';
export const describe = 'Create template from file tree';
export const builder = {
    interactive: {
        type: 'boolean',
        default: false,
        desc: 'Create template interactively'
    },
    binary: {
        type: 'string',
        default: true,
        desc: 'Algroithm used to handle binary files [auto|ask|base64|src|raw|skip]'
    }
};
export const handler = async ({ path, interactive }) => {
    console.log('NOT IMPLEMENTED!!!');
};
// npm run fileable template  --interactive . output.jsx
// Adding folder 'top'...
// Folder 'top' added.
// Adding file 'top/index.html'
// File 'top/index.html' added.
// Adding file 'img.png'...
// File 'img.png' appears to be a binary file. How would you like to handle this?
// >-encode file as base64
// - add as src
// - use raw data
// - skip
// Encoding 'img.png' as base 64
// File 'img.png' added
// Adding 'index.js'...
// File 'index.js' added
// Tree traversed.
// Writing 'output.jsx'
// Done.
