'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var iterator = _interopDefault(require('fileable-iterator'));
var fs = require('fs');
var path = require('path');
var rimraf = _interopDefault(require('rimraf'));
var util = require('util');
var glob = require('glob');
require('chalk');

// import CacheMap from './cache-map.ts';
const rmdir = util.promisify(rimraf);
const findFiles = util.promisify(glob.glob);

/**
* Render file tree to file system
* @kind function
* @name renderFS
* @param {function} input
* @param {object} options
* @param {string} options.folder_context - Folder into which files should be renddered
* @param {string} options.template_context - Location of template. Used to determine relateive
* @example
* ```javascript
* import {renderFS} from 'fileable';
* const main = async () =>
* renderFS(template, { folder_context: '.' });
* main();
* ```
*/

var renderFs = async (template,
    {
        folder_context = '',
        template_context = '',
        ignoreWarning = false,
        ignoreError = false,
        dieOnWarning = false,
    } ) => {

    try {
        const context = folder_context;
        for await (const {
            directive,
            target,
            name,
            append,
            content,
            folder_context,
            mode,
            message
        } of
            iterator(template, { folder_context: context, template_context })
        ) {
            switch (directive) {
                case 'FILE': {
                    const folderPath = path.join(folder_context);
                    if (!fs.existsSync(folderPath)) {
                        fs.mkdirSync(folderPath, { recursive: true });
                    }
                    const fileName = path.join(folderPath, name);
                    if (append) {
                        fs.appendFileSync(fileName, content, { mode });
                    } else {
                        fs.writeFileSync(fileName, content, { mode });
                    }
                } break;
                case 'FOLDER': {
                    const folderPath = path.join(folder_context, name);
                    if (!fs.existsSync(folderPath)) {
                        fs.mkdirSync(folderPath, { recursive: true });
                    }
                } break;
                case 'CLEAR': {
                    if (target) {
                        let files;
                        if (target[0] !== '!' ) {
                            files = await findFiles(path.join(folder_context, target));
                        } else {
                            files = await findFiles(path.join(folder_context, '**'), { ignore: target.substring(1) });
                        }
                        for (const file of files) {
                            if (fs.lstatSync(file).isDirectory()) {
                                continue;
                            }
                            fs.unlinkSync(file);
                        }
                    } else {
                        const folderPath = path.join(folder_context, target);
                        if (fs.existsSync(folderPath)) {
                            await rmdir(folderPath);
                        }
                    }
                } break;
                case 'WARNING': {
                    if (!ignoreWarning) {
                        console.log(message);
                        if (dieOnWarning) {
                            throw new Error(message);
                        }
                    }
                } break;
                case 'ERROR': {
                    if (!ignoreError) {
                        console.log(message);
                        throw new Error(message);
                    }
                } break;
                default: {
                    console.log({
                        directive,
                        target,
                        name,
                        append,
                        content,
                        folder_context,
                        mode
                    });
                }
            }
        }
    } catch (e) {
        console.log(e);
    } finally {

    }
};

const findFiles$1 = util.promisify(glob.glob);

var renderConsole = async (template, {
    folder_context = '',
    template_context = ''
}) => {
    console.log(folder_context);
    let previousContext = folder_context;
    let currentContext = '';
    let depth = 0;
    for await (const {directive, folder_context:context='', name, content, target} of iterator(template, {
        folder_context,
        template_context
    })) {
        currentContext = context;
        if (currentContext === previousContext) ; else if (currentContext
            .indexOf(previousContext) === 0) {//Push
            depth++;

        } else if (previousContext
            .indexOf(currentContext) === 0) {//Pop
            depth--;
        }
        const pre = [];
        switch (depth) {
            case 0:
                pre.push('');
                break;
            default:
                pre.push('|');
                for (let i = 0; i < 2 * depth - 1; i++) {
                    pre.push(' ');
                }
                break;
        }
        if (directive === 'FILE' || directive === 'FOLDER') {
            console.log(`+${pre.join('')}├ ${name}${content ? ` (${content.length} bytes)` :''  }`);
        } else if (directive === 'CLEAR') {
            if (target) {
                let files;
                if (target[0] !== '!') {
                    files = await findFiles$1(path.join(context, target));
                } else {
                    files = await findFiles$1(path.join(context, '**'), { ignore: target.substring(1) });
                }
                if (files && files.length) {
                    for (const file of files) {
                        if (fs.lstatSync(file).isDirectory()) {
                            continue;
                        }
                        console.log(`-${pre.join('')}├ ${file}`);
                    }
                } else {
                    console.log(`-${pre.join('')}├ ${path.join(context, target)}`);
                }
            } else {
                console.log(`-${pre.join('')}├ ${context}`);
            }
        }
        previousContext = currentContext;
    }
};

exports.renderConsole = renderConsole;
exports.renderFS = renderFs;
