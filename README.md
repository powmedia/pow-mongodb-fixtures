pow-mongodb-fixtures
=================

Simple fixture loader for MongoDB on NodeJS.  Makes managing relationships between documents easier.

Fixtures can be in one file, or divided up into separate files for organisation 
(e.g. one file per model)

The fixture files must export objects which are keyed by the MongoDB collection name, each
containing the data for documents within that.

FOR EXAMPLE:
With the file below, 3 documents will be inserted into the 'users' collection and 2 into the 'businesses' collection:

    //fixtures.js
    exports.users = [
        { name: 'Gob' },
        { name: 'Buster' },
        { name: 'Steve Holt' }
    ];

    exports.businesses = [
        { name: 'The Banana Stand' },
        { name: 'Bluth Homes' }
    ];


You can also load fixtures as an object where each document is keyed, in case you want to reference another document. This example uses the included `createObjectId` helper:

    //users.js
    var id = require('pow-mongodb-fixtures').createObjectId;

    var users = exports.users = {
        user1: {
            _id: id(),
            name: 'Michael'
        },
        user2: {
            _id: id(),
            name: 'George Michael',
            father: users.user1._id
        },
        user3: {
            _id: id('4ed2b809d7446b9a0e000014'),
            name: 'Tobias'
        }
    }


API
===

connect(dbname, options)
------------------------

Returns a new Loader instance, configured to interact with a certain database.

Options:

- host (Default: localhost)
- port (Default: 27017)

Usage:

    var fixtures = require('pow-mongodb-fixtures').connect('dbname');
    
    var fixtures2 = require('pow-mongodb-fixtures').connect('dbname', {
      host: 'http://dbhost.com/',
      port: 1234
    });


load(data, callback)
--------------------

Adds documents to the relevant collection. If the collection doesn't exist it will be created first.

    var fixtures = require('pow-mongodb-fixtures').connect('mydb');
    
    //Objects
    fixtures.load({
        users: [
            { name: 'Maeby' },
            { name: 'George Michael' }
        ]
    }, callback);

    //Files
    fixtures.load(__dirname + '/fixtures/users.js', cb);

    //Directories (loads all files in the directory)
    fixtures.load(__dirname + '/fixtures', callback);


clear(callback)
---------------

Clears existing data.

    fixtures.clear(function(err) {
        //Drops the database
    });
    
    fixtures.clear('foo', function(err) {
        //Clears the 'foo' collection
    });
    
    fixtures.clear(['foo', 'bar'], function(err) {
        //Clears the 'foo' and 'bar' collections
    });
    

clearAllAndLoad(data, callback)
----------------------------

Drops the database (clear all collections) and loads data.


clearAndLoad(data, callback)
----------------------------

Clears the collections that have documents in the `data` that is passed in, and then loads data.

    var data = { users: [...] };
    
    fixtures.clearAndLoad(data, function(err) {
        //Clears only the 'users' collection then loads data
    });
    

Installation
------------

	npm install pow-mongodb-fixtures
