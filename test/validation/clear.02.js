module.exports = [
    {
        name: 'a.html',
        message: 'unspecified file shuould remain'
    },
    {
        name: 'b.js',
        missing: true,
        message: 'specified file should be deleted'
    },
    {
        name: '0/c.html',
        message: 'unspecified file shuould remain'
    },
    {
        name: '0/d.js',
        missing: true,
        message: 'specified file should be deleted'
    }
];
