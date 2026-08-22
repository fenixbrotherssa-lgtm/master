const CONFIG = {
    ENV: 'production', 
    SERVER_ADDRESS: 'localhost',
    PORT: 4000, // Se mantiene referencial, el getApiUrl lo omitirá al ser dominio

    getApiUrl() {
        const isDomain = this.SERVER_ADDRESS.includes('.') && !/[0-9]$/.test(this.SERVER_ADDRESS);
        const protocol = isDomain ? 'https' : 'http';
        const suffix = isDomain ? '' : `:${this.PORT}`;
        return `${protocol}://${this.SERVER_ADDRESS}${suffix}/api`;
    }
};

module.exports = CONFIG;