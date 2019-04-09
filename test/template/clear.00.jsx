import React, { Fragment } from "react";
import File from 'fileable-component-file';
import Clear from 'fileable-component-clear';
export default async () => <>
    <File name='i_should_not_be' />
    <Clear>
        <File name='i_should_be' />
    </Clear>
</>;
