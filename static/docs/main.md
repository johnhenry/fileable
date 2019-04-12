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
