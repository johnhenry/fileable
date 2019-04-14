![fileable logo](./static/docs/logo.png)

# Fileable

Render a file tree using a JSX template.

Inspired by [React FS Renderer](https://github.com/ericvicenti/react-fs-renderer)

## API -- Template

Fileable can render [functional components](https://reactjs.org/docs/components-and-props.html) built with the following components:

### Component: React.Fragment

React.Fragment can be used to group files and folders

```javascript
import {Fragment} from 'react';
const template = ()=><>
    <File name='empty_file'/>
    <Folder name='empty_folder'/>
</>;
```

## CLI Installation

```sh
npm install global fileable
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

| Parameter | Type   | Description |
| :-------- | :----- | :---------- |
| `input`   | object |             |

#### Examples

> ```javascript
> import {iterator} from 'fileable';
> ```

* * *

### function renderConsole

Render to Console

| Parameter | Type   | Description |
| :-------- | :----- | :---------- |
| `input`   | object |             |

#### Examples

> ```javascript
> import {renderConsole} from 'fileable';
> const main = async () =>
> renderConsole(template(), { folder_context: directory });
> main();
> ```

* * *

### function renderFS

Render to File System

| Parameter | Type   | Description |
| :-------- | :----- | :---------- |
| `input`   | object |             |

#### Examples

> ```javascript
> import {renderFS} from 'fileable';
> const main = async () =>
> renderFS(template(), { folder_context: directory });
> main();
> ```

## Todo

- Asynchronous content
- Document newline trickiness
    - inability to insert new lines easily
    - must manually add "{'\n'}" or enclose entirely witin backticks ({"``"})
    - <File end />
- Separate docummetation fileable, fileable-components
- Eventually, get remote files working with using dynamic imports
- add "reverse-build"
- test multiple scenarious:
     - local input + remote templated
     - local input + local templated
     - remote input + remote templated
     - local input + local templated
     - no input + remote templated
     - no input + local templated
- remote template context
- generate included versions of components and include in documentation
- typescript
