import React, { Fragment } from "react";
import File from 'fileable-component-file';
import Folder from 'fileable-component-folder';
export default async () => <>
    <Folder name='top'>
        <File></File>
        <Folder name='next'></Folder>
    </Folder>
    <Folder name='zipped' zip extension='.zip'>
        <File extension='.txt'>Zipped in the content</File>
    </Folder>
</>;
