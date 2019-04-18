module.exports = [
    {
        name: 'a.html',
        missing: true,
        message: 'specified file should be deleted'

    },
    {
        name: 'b.js',
        message: 'unspecified file shuould remain'
    },
    {
        name: '0/c.html',
        missing: true,
        message: 'specified file should be deleted'
    },
    {
        name: '0/d.js',
        message: 'unspecified file shuould remain'
    }
];
