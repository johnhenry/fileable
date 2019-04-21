

import { renderFS, renderConsole } from '../';
import tester from './tester.js';

import templateFile00 from './template/file.00.jsx';
import templateFolder00 from './template/folder.00.jsx';
import templateClear00 from './template/clear.00.jsx';
import templateClear01 from './template/clear.01.jsx';
import templateClear02 from './template/clear.02.jsx';
import templateInput00 from './template/input.00.jsx';

import templateFileValidation00 from './validation/file.00.js';
import templateFolderValidation00 from './validation/folder.00.js';
import templateClearValidation00 from './validation/clear.00.js';
import templateClearValidation01 from './validation/clear.01.js';
import templateClearValidation02 from './validation/clear.02.js';
import templateInputValidation00 from './validation/input.00.js';

import input00 from './inputs/00.js';

const folder_context = './dist/temp';
const renderOptions = {
    folder_context,
    template_context: './test/template'
};
const testafileOptions = {
    message: 'it should generate a given file tree'
};

tester('build file 00'
    , folder_context
    , async () => await renderFS(templateFile00, renderOptions)
    , templateFileValidation00
    , testafileOptions);

tester('build folder 00'
    , folder_context
    , async () => await renderFS(templateFolder00, renderOptions)
    , templateFolderValidation00
    , testafileOptions);

tester('build clear 00'
    , folder_context
    , async () => await renderFS(templateClear00, renderOptions)
    , templateClearValidation00
    , testafileOptions);

tester('build clear 01'
    , folder_context
    , async () => await renderFS(templateClear01, renderOptions)
    , templateClearValidation01
    , testafileOptions);

tester('build clear 02'
    , folder_context
    , async () => await renderFS(templateClear02, renderOptions)
    , templateClearValidation02
    , testafileOptions);

tester('build w/input 00'
    , folder_context
    , async () => await renderFS(templateInput00(...input00), renderOptions)
    , templateInputValidation00
    , testafileOptions);
