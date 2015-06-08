var restify = require('restify'),
    Datastore = require('nedb'),
    db = new Datastore({
        filename: 'data/users.nedb',
        autoload: true
    }),
    winston = require('winston'),
    crypto = require('crypto'),
    swot = require('swot-simple'),
    fs = require('fs'),
    child_process = require('child_process');




// Setup logging.
var log = new(winston.Logger)({
    transports: [
        new(winston.transports.Console)({
            level: 'debug'
        }),
        new(winston.transports.File)({
            filename: 'log.log',
            level: 'debug'
        })
    ]
});

// Configure the database.
db.ensureIndex({
    fieldName: 'email',
    unique: true
}, function(err) {
    if (err) {
        log.error("ensureIndex: %j", err)
    }
});

db.ensureIndex({
    fieldName: 'username',
    unique: true
}, function(err) {
    if (err) {
        log.error("ensureIndex: %j", err)
    }
});

function valid_username(username) {
    var valid_username_re = /^[a-z0-9_-]{3,15}$/;
    var regex = new RegExp(valid_username_re);

    return regex.test(username);
}

function register_account(req, res, next) {
    // TODO: Maybe should check email exists before doing this, thought its sitll caught by the DBs index.
    var insert_data = {};

    insert_data['username'] = req.body.username;

    if (!valid_username(insert_data['username'])) {
        log.error("username is not a valid unix username '%s'.", insert_data['username']);
        return next(new restify.InvalidArgumentError('Your username is not valid. It can only contain ascii characters.'));
    }

    insert_data['email'] = req.body.email;

    if (!swot.isAcademic(insert_data['email'])) {
        log.error("email address invalid '%s'.", insert_data['email']);
        return next(new restify.InvalidArgumentError('Your email address is invalid. Is this an academic email address?'));
    }

    insert_data['pubkey'] = req.body.pubkey;

    //var d = crypto.createHash('sha1'); // TODO: Make this random.
    //insert_data['activation_key'] = d.digest('hex');
    insert_data['activation_key'] = crypto.randomBytes(25).toString('hex');

    db.insert(insert_data, function(err, data) {
        if (err && err.errorType == "uniqueViolated") {
            res.status(400);
            log.error(err)
            log.verbose("Attempted to create an existing account.", insert_data);
            res.send('This email address or username has already been registered.');
        } else if (err) {
            res.status(500);
            log.error("register_account.insert(): ", err);
            res.send('There has been a problem.');
        } else if (!err && data) {
            res.status(201);
            log.info("Account '%s' created.", data.email);
            console.log(insert_data);
            res.send('Acount created, check your inbox.');
        }
    });

    // TODO: Check for public GPG Key
    // TODO: Send verification email

    next();
}

function expire_first_login_passwd(username) {
    child_process.execFile('/usr/bin/chage', ['-d', '0', username], function(error, stdout, stderr) {
        if (stdout) {
            log.info(stdout);
        }
        if (error) {
            log.error(stderr);
            log.error(error);
        }
    });
}

function clear_first_login_passwd(username) {
    child_process.execFile('/usr/bin/passwd', ['-d', username], function(error, stdout, stderr) {
        if (stdout) {
            log.info(stdout);
        }
        if (error) {
            log.error(stderr);
            log.error(error);
        } else {
            expire_first_login_passwd(username);
        }
    });
}

function chown_user_authorized_keys(username, authorized_keys) {
    child_process.execFile('/bin/chown', [username, authorized_keys], function(error, stdout, stderr) {
        if (stdout) {
            log.info(stdout);
        }
        if (error) {
            log.error(stderr);
            log.error(error);
        } else {
            clear_first_login_passwd(username);
        }
    });
}

function create_user_authorized_keys(username, public_key) {
    var user_ssh_dir = "/home/" + username + "/.ssh/";
    var authorized_keys = user_ssh_dir + "authorized_keys";
    fs.writeFile(authorized_keys, public_key, function(error) {
        if (error) {
            log.error("error writing public key for " + username);
            log.error(err);
        } else {
            chown_user_authorized_keys(username, authorized_keys);
        }
    });
}


// We expect that username has already been sanitised.
function create_user(username, public_key) {
    child_process.execFile('/usr/sbin/adduser', ['--disabled-login', '--disabled-password', '--gecos', '""', username], function(error, stdout, stderr) {
        if (stdout) {
            log.info(stdout);
        }
        if (error !== null) {
            log.error('exec (create user) error: ' + error);
        } else {
            create_user_authorized_keys(username, public_key);
        }
    });
}

function create_user_via_activation(activation_keys_account, res) {
    db.update({
        activation_key: activation_keys_account.activation_key
    }, {
        $unset: {
            activation_key: true
        }
    }, {}, function(err, numReplaced, newDoc) {
        if (numReplaced != 1) {
            res.status(500);
            log.verbose("Unable to activate account with ID: '%s'.", req.params.activation_key);
            res.send('Unable to activate account.');
        } else if (err) {
            res.status(500);
            log.error("activate_account.update(): ", err);
            res.send('Unable to activate account.');
        } else {
            res.status(201);
            log.info('User verified email.');
            create_user(activation_keys_account.username, activation_keys_account.pubkey);
            res.send('Account activated.');
        }
    });
}

function activate_account(req, res, next) {
    // First get data associated with activation_key
    activation_keys_account = null;
    db.find({
        activation_key: req.params.activation_key
    }, function(err, results) {
        // If no activation key is found then results is empty
        if (results.length === 0) {
            res.status(500);
            log.verbose("Unable to activate account with ID: '%s'.", req.params.activation_key);
            res.send('Unable to activate account.');
        } else if (results.length !== 1) {
            log.error("We seem to have found a duplicate activation key");
            res.status(500);
            res.send('Unable to activate account.');
        } else {
            activation_keys_account = results[0];
            create_user_via_activation(activation_keys_account, res);
        }

    });

    next();
}




var server = restify.createServer();

server.get('/activate/:activation_key', activate_account);
server.head('/activate/:activation_key', activate_account);

server.use(restify.urlEncodedBodyParser({
    mapParams: false
}));
server.post('join', register_account);

server.get('html/.*', restify.serveStatic({
    directory: './static/',
}));

server.listen(8080, function() {
    log.info('Server started on %s', server.url);
});

// Functions to parse-user input.

// Register an account
// Check email is free
// Check for public GPG Key
// Send verification email

// Account Activation
// confirm verification ID from email
// Configure User space

// Add SSH Public Key

// TODO: Handle signals.
