const mongoose = require('mongoose');
const User = require('./models/User');
const Log = require('./models/Log');

// Fail fast instead of buffering queries forever when the database is unreachable
mongoose.set('bufferCommands', false);

async function connectDB(uri = process.env.MONGODB_URI) {
    if (!uri) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('MONGODB_URI environment variable is required in production.');
        }
        uri = 'mongodb://127.0.0.1:27017/carbonwise';
        console.warn(`MONGODB_URI not set; using local database ${uri}`);
    }

    // Optional override for machines whose resolver can't answer the SRV lookups
    // that mongodb+srv:// URIs need (e.g. DNS_SERVERS=8.8.8.8,1.1.1.1)
    if (process.env.DNS_SERVERS) {
        require('dns').setServers(process.env.DNS_SERVERS.split(',').map(s => s.trim()));
    }

    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    // Build indexes now that we're connected (e.g. the unique email index);
    // automatic index builds are skipped because command buffering is disabled
    await Promise.all([User.createIndexes(), Log.createIndexes()]);
    console.log(`Connected to MongoDB database "${mongoose.connection.name}".`);
    return mongoose.connection;
}

module.exports = { connectDB };
