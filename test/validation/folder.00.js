const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

module.exports = [
    {
        name: 'top',
        message: 'folder should be created containing items',
        children: [
            {
                name: 'next',
                message: 'sub-folder should be created within folder'
            },
            {
                name: EMPTY_HASH,
                message: 'file should be created within folder'
            },
        ]

    },
    {
        name: 'zipped.zip',
        message: 'zipped folder should be created'
    }
];
