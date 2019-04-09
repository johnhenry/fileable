import React, { Fragment } from "react";
import File from 'fileable-component-file';
export default async () => <>
    <File></File>
    <File name="empty" />
    <File extension=".md" />
    <File name="empty" extension=".md" />
    <File name="hello">Hello</File>
    <File name="world" content="World" />
    <File name="google.html" src='https://www.google.com' />
    <File name="package.json" src='../../package.json' />
    <File name="datefile" cmd='date' />
    <File name='foodfile' cmd='|grep Cheese'>{
`- Feta Cheese
- Broccoli
- American Cheese
- Cheesebread`
    }</File>
    <File name="permission" mode={0o655} />
    <File name="index.html" >
    <html>

    </html>
    </File>
    <File name="index-doctype.html" doctype="html">
        <html>

        </html>
    </File>
    <File name="double" transform={(buff) => Buffer.concat([buff, buff])} >Hello</File>
    <File name="doubleps" transform={(buff) => Buffer.concat([buff, buff])} >Hello<File ps>Goodbye</File></File>
    <File name='doubleclone'>World<File clone /></File>;
    {/* <File name='a.txt' end>
        hello{'\n'}
        <File clone ps='there' name='b.txt'/>
    </File>; */}
</>;
