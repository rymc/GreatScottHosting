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
    child_process = require('child_process'),
    Email = require('email').Email,
    xkcdPassword = require('xkcd-password');

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

// Read in reserved names
var reservedUsers = [];
try {
    reservedUsers = fs.readFileSync('reserved-users').toString().split("\n");
} catch (e) {
    log.error("Error reading reservered-users file: %j", e)
}

// Read in email addresses to bcc on registrations
var bccUserEmails = [];
try {
    bccUserEmails = fs.readFileSync('bcc-users').toString().split("\n");
    // Remove any empty elements
    bccUserEmails = bccUserEmails.filter(function(e) {
        return e
    });
} catch (e) {
    log.error("Error reading bcc-users file: %j", e)
}

log.error(bccUserEmails);

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

function valid_unix_username(username) {
    var valid_username_re = /^[a-z0-9_-]{3,15}$/;
    var regex = new RegExp(valid_username_re);

    return regex.test(username);
}


function non_reserved_username(username) {
    var valid = true;
    if (reservedUsers.length > 0 && reservedUsers.indexOf(username) !== -1) {
        valid = false;
    }

    return valid;
}

function send_registration_email(user_name, user_email, activation_key, bcc_users) {
    var mail = new Email({
        from: 'charliekelly@matrix.ac',
        to: user_email,
        bcc: bcc_users,
        subject: 'Your matrix account',
        body: 'Hello ' + user_name + '\r\n\r\nPlease confirm that you would like to register for an account at matrix.ac by activating your account with the following words: http://matrix.ac/registration/activate/' + activation_key + '\r\n\r\nIf you did not take any actions that would cause you to receive this email, you can safely ignore it.\r\n\r\nmatrix.ac\r\n\r\nPlease do not reply to this email.',
    });

    mail.path = '/usr/sbin/sendmail';
    mail.send();
}

function register_account(req, res, next) {
    // TODO: Maybe should check email exists before doing this, thought its sitll caught by the DBs index.
    var insert_data = {};

    insert_data['username'] = req.body.username;

    if (!valid_unix_username(insert_data['username']) || !non_reserved_username(insert_data['username'])) {
        log.error("username is not a valid username '%s'.", insert_data['username']);
        if (req.headers['user-agent'].indexOf("curl") > -1) {
            return next(new restify.InvalidArgumentError('Your username is not valid. Sorry.'));
        }
        res.header('Location', '/u_problem.html');
        res.send(302);
        return next();
    }

    insert_data['email'] = req.body.email;

    if (!swot.isAcademic(insert_data['email'])) {
        log.error("email address invalid '%s'.", insert_data['email']);

        if (req.headers['user-agent'].indexOf("curl") > -1) {
            return next(new restify.InvalidArgumentError('Your email address is invalid. Is this an academic email address?'));
        }
        res.header('Location', '/e_problem.html');
        res.send(302);
        return next();
    }

    insert_data['pubkey'] = req.body.pubkey;

    var options = {
        numWords: 4,
        minLength: 3,
        maxLength: 20
    };
    var pw = new xkcdPassword();

    pw.generate(options, function(err, result) {
        if (err) {
            insert_data['activation_key'] = crypto.randomBytes(25).toString('hex');
        } else {
            var words = "";
            for (word in result) {
                if (word > 0)
                    words += "-" + result[word];
                else
                    words += result[word];
            }
            insert_data['activation_key'] = words;
        }


        insert_reg_data(res, insert_data);
    });


    // TODO: Check for public GPG Key

    next();
}

function insert_reg_data(res, insert_data) {

    db.insert(insert_data, function(err, data) {
        if (err && err.errorType == "uniqueViolated") {
            res.status(400);
            log.error(err)
            log.verbose("Attempted to create an existing account.", insert_data);
            res.header('Location', '/m_taken.html');
            res.send(302);
            return next();
        } else if (err) {
            res.status(500);
            log.error("register_account.insert(): ", err);
            res.header('Location', '/m_problem.html');
            res.send(302);
            return next();
        } else if (!err && data) {
            res.status(201);
            log.info("Account '%s' created.", data.email);
            console.log(insert_data);
            send_registration_email(insert_data['username'], insert_data['email'], insert_data['activation_key'], bccUserEmails)
            res.header('Location', '/m_created.html');
            res.send(302);
            return next();
        }
    });



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
            res.header('Location', '/m_activate_failed.html');
            res.send(302);
            return next();
        } else if (err) {
            res.status(500);
            log.error("activate_account.update(): ", err);
            res.header('Location', '/m_activate_failed.html');
            res.send(302);
            return next();
        } else {
            res.status(201);
            log.info('User verified email.');
            create_user(activation_keys_account.username, activation_keys_account.pubkey);
            res.header('Location', '/m_activated.html');
            res.send(302);
            return next();
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
            if (req.headers['user-agent'].indexOf("curl") > -1) {
                res.send('Unable to activate account.');
            }
            res.header('Location', '/m_activate_failed.html');
            res.send(302, 'Unable to activate account.');
            return next();
        } else if (results.length !== 1) {
            log.error("We seem to have found a duplicate activation key");
            res.status(500);
            if (req.headers['user-agent'].indexOf("curl") > -1) {
                res.send('Unable to activate account.');
            }
            res.header('Location', '/m_activate_failed.html');
            res.send(302);
            return next();
        } else {
            activation_keys_account = results[0];
            create_user_via_activation(activation_keys_account, res);
        }

    });

    next();
}

var server = restify.createServer();

server.get('/', function(req, res, next) {
    res.header('Location', '/');
    res.send(302, 'Nothing to see here');
});

server.get('/activate/:activation_key', activate_account);
server.head('/activate/:activation_key', activate_account);

server.use(restify.urlEncodedBodyParser({
    mapParams: false
}));

server.post('/join', register_account);

server.listen(8080, '127.0.0.1', function() {
    log.info('Server started on %s', server.url);
});


// TODO: Check for public GPG Key
// TODO: Handle signals.