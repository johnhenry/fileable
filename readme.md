![fileable logo](./static/docs/logo.png)

# Fileable

Render a file tree using a JSX template.

Inspired by [React FS Renderer](https://github.com/ericvicenti/react-fs-renderer).

For the command line application, see [fileable-cli](https://github.com/johnhenry/fileable-cli)

## Installation

```sh
npm install fileable
```

## Usage

## Bacis Usage

```javascript
import { renderConsole, renderFS } from 'fileable';
import template from './path/to/sample-template.jsx';
const options = {
 template_context:'./path/to/',
 folder_context: './destination'
};
renderConsole(template, options);
renderFS(template, options);
```

### Templates Files

Templates are jsx files. The default export will be used to generate a file tree.
(Note: You must always include a reference to 'React');

```javascript
import React, {Fragment} from 'react';
export default ()=><></>;
```

#### Components

By default, [React.Fragments](https://reactjs.org/docs/fragments.html) are available and other components may be imported if installed locally.

```sh
npm install fileable-component-file fileable-component-folder fileable-component-clear
```

```javascript
import React, {Fragment} from 'react';
import File from 'fileable-component-file';
import Folder from 'fileable-component-folder';
import Clear from 'fileable-component-clear';
export default ()=><>
    <Clear>
    <File name='readme.md'>
    # I am a readme
    </File>
    <Folder name='src'>
        <File name='index.html' doctype='html'>
        <html>
            <head></head>
            <scrpit src='index.js'></script>
            <body>
                See Console for result.
            </body>
        </html>
        </File>
        <File name='index.js'>
        console.log('hello world');
        </File>
    </Folder>
    </Clear>
</>
```

Components cand be composed and extended.

```javascript
import React from 'react';
import File from 'fileable-component-file';
import Folder from 'fileable-component-folder';
import Clear from 'fileable-component-clear';
const DateFile = () =><File name='today.date' cmd='date' />
export default ()=><>
    <Clear>
    <File name='readme.md'>
    # I am a readme
    </File>
    <DateFile />
    </Clear>
</>
```

See [fileable-components](https://github.com/johnhenry/fileable-components) for a list of components  and to learn how to build your own.

#### Inputs

If the template would accept inputs, you may pass them into the template as a function arguments;

```javascript
export default (first, second, third)=><>...
```

```javascript
import {renderFS} from 'fileable';
import template from './path/to/sample-template.jsx';
const template_context = './path/to/';
const folder_context = './destination';
renderFS(template('first', 'second', 'third'), { folder_context, template_context});
```
## API

### Table of contents

- [function iterator](#function-iterator)
  - [Examples](#examples)
- [function renderConsole](#function-renderconsole)
  - [Examples](#examples-1)
- [function renderFS](#function-renderfs)
  - [Examples](#examples-2)

### function iterator

Iterator

| Parameter                  | Type   | Description                                                                            |
| :------------------------- | :----- | :------------------------------------------------------------------------------------- |
| `options`                  | object |                                                                                        |
| `options.folder_context`   | string | Folder into which files should be rendered.                                            |
| `options.template_context` | string | Location of template. Used to determine relative relative paths of certain attributes. |

#### Examples

> ```javascript
> import {iterator} from 'fileable';
> const main = async ()=>{
>  for await(const output of iterator(template, {})){
>    console.log(output);
>  }
> }
> ```

* * *

### function renderConsole

Render file tree to console

| Parameter                  | Type     | Description                                                        |
| :------------------------- | :------- | :----------------------------------------------------------------- |
| `input`                    | function |                                                                    |
| `options`                  | object   |                                                                    |
| `options.folder_context`   | string   | Folder into which files should be renddered                        |
| `options.template_context` | string   | Location of template. Used to determine relateive 'src' attributes |

#### Examples

> ```javascript
> import { renderConsole, iterator } from 'fileable';
> const main = async () =>
> renderConsole(template, { folder_context: '.' });
> main();
> ```

* * *

### function renderFS

Render file tree to file system

| Parameter                  | Type     | Description                                       |
| :------------------------- | :------- | :------------------------------------------------ |
| `input`                    | function |                                                   |
| `options`                  | object   |                                                   |
| `options.folder_context`   | string   | Folder into which files should be renddered       |
| `options.template_context` | string   | Location of template. Used to determine relateive |

#### Examples

> ```javascript
> import {renderFS} from 'fileable';
> const main = async () =>
> renderFS(template, { folder_context: '.' });
> main();
> ```

## Todo

- remove unnecessary dependencies
- add proper typescript typeings
- test multiple scenarious:
     - local input + remote templated
     - local input + local templated
     - remote input + remote templated
     - local input + local templated
     - no input + remote templated
     - no input + local templated
