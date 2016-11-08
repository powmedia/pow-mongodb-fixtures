[![Build Status](https://travis-ci.org/powmedia/pow-mongodb-fixtures.svg?branch=master)](https://travis-ci.org/powmedia/pow-mongodb-fixtures)

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


CLI usage
=========

A CLI program is included for quickly loading fixture files. To use it install the module globally:

    npm install pow-mongodb-fixtures -g

Then use the program to install a file or directory:

    mongofixtures <dbname> <fixture file>

    mongofixtures appdb fixtures/users.js


API
===

connect(dbname, options)
------------------------

Returns a new Loader instance, configured to interact with a certain database.

Options:

- host (Default: localhost)
- port (Default: 27017)
- user
- pass
- safe (Default: false)

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
    

addModifier(callback)
----------------------------

Adds a modifier (function) which gets called for each document that is to be inserted. The signature of this function
should be:

    (collectionName, document, callback)

* collectionName - name of collection
* document - the document which is to be inserted
* callback - function with signature (err, modifiedDocument). This should be called with the modified document.

Modifiers are chained in the order in which they're added. For example:


    var data = { users: [...] };

    // this modifier will get called first
    fixtures.addModifier(function(collectionName, doc, cb) {
      doc.createdAt = new Date();

      cb(null, doc);
    });

    // this modifier will get called second with the result from the first modifier call
    fixtures.addModifier(function(collectionName, doc, cb) {
      doc.updatedAt = new Date();

      cb(null, doc);
    });

    fixtures.load(data, function(err) {
        // each loaded data item will have the createdAt and updatedAt keys set.
    });


Installation
------------

	npm install pow-mongodb-fixtures


Changelog
---------

###0.14.0
- Update mongodb to 2.2.x

###0.13.0  
- Update mongodb driver to 2.0.x  
- Updated `collection.insert` with `collection.insertMany` - the former is marked for deprecation in version 3.x  
- Move to Lo-Dash from Underscore

###0.10.0
- Update mongodb driver to 1.3.x
- Add ability to connect with URI
- Make safe mode the default

###0.8.1
- Add mongofixtures CLI program

###0.7.1
- Add 'safe' option (donnut)

###0.7.0
- Add user and password options for connecting to authenticated/remote DBs

###0.6.4
- Add username and password connect options

###0.6.3
- Make clear be safe

###0.6.2
- Windows fixes (samitny)

###0.6.1
- Ignore subdirectories (hiddentao)
