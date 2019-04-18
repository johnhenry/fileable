const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

module.exports = [
    {
        name: EMPTY_HASH,
        message: 'empty file should be created with computed hash'
    },
    {
        name: 'empty',
        message: 'file should be created with given name'
    },
    {
        name: 'empty.md',
        message: 'file should be created with given name and extension'
    },
    {
        name: `${EMPTY_HASH}.md`,
        message: 'file should be created with computed hash and given extension'
    },
    {
        name: 'hello',
        stringContent: 'Hello',
        message: 'file should be created with children as content'
    },
    {
        name: 'world',
        stringContent: 'World',
        message: 'file should be created with children as content'

    },
    {
        name: 'google.html',
        stringIndicies: [
            {
                index: 0,
                content: '<!doctype html>'
            }
        ],
        message: 'file should be downloaded'
    },
    {
        name: 'package.json',
        stringIndicies: [
            {
                index: 0,
                content: '{'
            }
        ],
        message: 'local file should be downloaded relative to template'
    },
    {
        name: 'datefile',
        test: (content) => Math.abs(new Date(content.toString()) - Date.now()) < 10000,
        message: 'file should be generated dynamically from command'
    }
    ,
    {
        name: 'foodfile',
        stringIndicies: [
            {
                index: -1,
                content: 'Broccoli'
            }
        ],
        message: 'file should be content should be piped through command'
    },
    {
        name: 'permission',
        mode: 0o655,
        message: 'file should be created with mode 655'
    },
    {
        name: 'index.html',
        stringIndicies: [
            {
                index: 0,
                content: '<html>'
            }
        ],
        message: 'html should be rendered'
    },
    {
        name: 'index-doctype.html',
        stringIndicies: [
            {
                index: 0,
                content: '<!doctype html>'
            }
        ],
        message: 'doctype preamble should be rendered'
    },
    {
        name: 'double',
        stringContent: 'HelloHello',
        message: 'file should be transformed'
    },
    {
        name: 'doubleps',
        stringContent: 'HelloHelloGoodbye',
        message: 'ps innerfile should not be transformed'
    },
    {
        name: 'doubleclone',
        stringContent: 'WorldWorld',
        message: 'cloned innerfile should be transormed'
    }
    ,
    {
        name: 'composed',
        message: 'components should be composable'
    }
    ,
    {
        name: 'append',
        stringContent: '01',
        message: 'content should be appended'
    }
    ,
    {
        name: 'end',
        stringContent: '1\n',
        message: 'new line should be appended to end of file'
    },
    {
        name: 'multi-0',
        stringIndicies: [
            {
                index: 0,
                content: '0'
            }
        ],
        message: 'multiple files should be created by component'
    },
    {
        name: 'multi-1',
        stringIndicies: [
            {
                index: 0,
                content: '1'
            }
        ],
        message: 'multiple files should be created by component'
    },
    {
        name: 'multi-2',
        stringIndicies: [
            {
                index: 0,
                content: '2'
            }
        ],
        message: 'multiple files should be created by component'
    }
];
