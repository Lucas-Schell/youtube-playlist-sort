const fs = require('fs');

//google stuff
const readline = require('readline');
const {google} = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtubepartner',
    'https://www.googleapis.com/auth/plus.login',
    'https://www.googleapis.com/auth/userinfo.email'
];
const TOKEN_DIR = 'users/credentials';
const TOKEN_PATH = TOKEN_DIR + '-youtube-playlist-sort.json';

//get video info
const ytdl = require('youtube-dl')
//json of artist names for better results
let data = require('./data.json');

//important variables
const listSongs = [];
const playlistList = []
let playlistId = '';

// Load client secrets from a local file.
fs.readFile('client_secret.json', function processClientSecrets(err, content) {
    if (err) {
        console.log('Error loading client secret file: ' + err);
        return;
    }
    // Authorize a client with the loaded credentials, then call the method.
    authorize(JSON.parse(content), getPlaylists);
});

//get auth
function authorize(credentials, callback) {
    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];

    var oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);
    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, function (err, token) {
        if (err) {
            getNewToken(oauth2Client, callback);
        } else {
            oauth2Client.credentials = JSON.parse(token);
            callback(oauth2Client);
        }
    });
}

//get token if not stored
function getNewToken(oauth2Client, callback) {
    var authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
    });
    console.log('Authorize this app by visiting this url: ', authUrl);
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question('Enter the code from that page here: ', function (code) {
        rl.close();
        oauth2Client.getToken(code, function (err, token) {
            if (err) {
                console.log('Error while trying to retrieve access token', err);
                return;
            }
            oauth2Client.credentials = token;
            storeToken(token);
            callback(oauth2Client);
        });
    });

}

//store the token
function storeToken(token) {
    try {
        fs.mkdirSync(TOKEN_DIR);
    } catch (err) {
        if (err.code != 'EEXIST') {
            throw err;
        }
    }
    fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) throw err;
        console.log('Token stored to ' + TOKEN_PATH);
    });

}

//get a list of playlist
function getPlaylists(auth, next) {
    const token = next ? next : '';
    const service = google.youtube('v3');

    service.playlists.list({
        auth: auth,
        part: 'snippet,contentDetails',
        mine: 'true',
        pageToken: token,
        maxResults: 50
    }).then(function (response) {
            //save the playlist name, id and size and print the name
            response.data.items.forEach(item => {
                console.log(item.snippet.title)
                playlistList.push({
                    name: item.snippet.title.toLowerCase(),
                    id: item.id,
                    size: item.contentDetails.itemCount
                })
            })

            //if there is nextPageToken call the method recursively with the new page token
            if (response.data.nextPageToken) {
                getPlaylists(auth, response.data.nextPageToken)
            } else {
                //get input and search the list of playlists for the match
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                rl.question('Enter the playlist name: ', function (playlistName) {
                    rl.close();
                    playlistList.forEach(async (item) => {
                        if (item.name === playlistName.toLowerCase()) {
                            playlistId = item.id
                            //after getting the playlistID call getSongs to get all videos from the playlist
                            console.log('Getting songs')
                            await getSongs(auth, item.size);
                        }
                    })
                    if (!playlistId) {
                        console.log('Playlist name not found')
                    }
                });
            }
        },
        function (err) {
            console.error("Execute error", err);
        });

}

//get playlist songs
const getSongs = (auth, size, next) => new Promise((resolve, reject) => {
    const token = next ? next : '';
    const service = google.youtube('v3');

    service.playlistItems.list({
        auth: auth,
        part: [
            'snippet'
        ],
        playlistId: playlistId,
        pageToken: token,
        maxResults: 50
    }).then(async function (response) {
            //go through the list of videos and save the id, resourceId and title in the list of objects listSongs
            response.data.items.map(async (item) => {
                listSongs.push({
                    id: item.id,
                    resourceId: item.snippet.resourceId,
                    title: item.snippet.title
                })
                //if the length of the list is equal to the size of the playlist all songs have been added
                if (listSongs.length === size) {
                    getInfo(auth)
                }
            })
            if (response.data.nextPageToken) {
                await getSongs(auth, size, response.data.nextPageToken)
            }
        },
        function (err) {
            reject("Execute error", err);
        })
})

//get the info of all videos in listSongs using youtube-dl
function getInfo(auth) {
    console.log('Getting info of the videos (this may take a while)')
    const urlList = []
    for (let value of listSongs) {
        urlList.push('https://www.youtube.com/watch?v=' + value.resourceId.videoId)
    }

    ytdl.getInfo(urlList, undefined, function (err, info) {
        if (err) throw err
        console.log('Updating artist and track...')
        updateArtist(info)

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        //write in another file to be able to change the data
        fs.writeFileSync('./changeHere.json', JSON.stringify(data));
        rl.question('\n\nChange the artist name in changeHere.json if it is needed \n(Example: "ArtistVevo": "ArtistVevo" -> "ArtistVevo": "Artist")' +
            '\n\nTo add a new artist: add the name to the list(do not forget the comma) and add it with the others below' +
            '\n(Example "list": ["ArtistVevo"] -> "list": ["ArtistVevo", "New Artist"]' +
            '\nAND below the list change "ArtistVevo": "Artist" -> "ArtistVevo": "Artist", "New Artist": "New Artist")' +
            '\n\nPress enter to sort the playlist', function () {

            rl.close();
            //get the new json after the changes
            data = require('./changeHere.json')
            console.log('Getting new information...')
            setTimeout(function () {
                fs.writeFileSync('./data.json', JSON.stringify(data))
                //update with the new information
                updateArtist(info)
                sortPlaylistItems()
                console.log('Updating position...')
                //attPos(auth, 0)
            }, 3000);
        });
    })
}

//sort listSongs
function sortPlaylistItems() {
    console.log('Sorting songs...')
    //it will sort by artists, if it is the same artist then it will be sorted by the track name(that can be the video title)
    listSongs.sort(function (a, b) {
        return a.artist === b.artist ? ('' + a.track).localeCompare(b.track) : ('' + a.artist).localeCompare(b.artist);
    })
}

//update the video position using the index
function attPos(auth, index) {
    const item = listSongs[index];
    const service = google.youtube('v3');

    service.playlistItems.update({
        auth: auth,
        part: [
            "snippet"
        ],
        resource: {
            "snippet": {
                "position": index,
                "playlistId": playlistId,
                "resourceId": {
                    "kind": item.resourceId.kind,
                    "videoId": item.resourceId.videoId
                }
            },
            id: item.id
        }
    }).then(function (response) {
            //print the song info and call itself with the next index
            console.log(index + ' ' + (item.artist !== null ? item.artist : item.title) + ' ' + item.track)
            if (list.length !== index + 1) {
                attPos(auth, (index + 1))
            }
        },
        function (err) {
            console.error("Execute error", err);
        });
}

//get artist and track name using youtube-dl
function updateArtist(info) {
    //the youtube-dl method returns a list of video info
    for (let i = 0; i < listSongs.length; i++) {
        //search for the artist name in the title using the json file
        for (let j = 0; j < data.list.length; j++) {
            //if the artist is stored in the json save the name in the object
            if ((listSongs[i].title.toLowerCase()).includes(data.list[j].toLowerCase())) {
                listSongs[i].track = info[i].track === null ? listSongs[i].title : info[i].track
                listSongs[i].artist = data[data.list[j]]
                break
            }
        }
        //check if the artist was found in the json
        if (!listSongs[i].artist) {
            //if the youtube-dl couldn't get the artist and track of the videos update the artist to null and the track to the title of the video
            if (info[i].track === null || info[i].artist === null) {
                listSongs[i].track = listSongs[i].title
                listSongs[i].artist = info[i].artist
                console.log('\nArtist not found in data.json and song info not found by youtube-dl:\n' + listSongs[i].title)
            } else {
                //check if artist is in json to better results
                listSongs[i].track = info[i].track
                if (data[info[i].artist]) {
                    listSongs[i].artist = data[info[i].artist]
                } else {
                    listSongs[i].artist = info[i].artist
                }
                //if the artist is not in the json update the file
                if (!data.list.includes(info[i].artist)) {
                    data.list.push(info[i].artist)
                    data[info[i].artist] = info[i].artist
                    fs.writeFileSync('./data.json', JSON.stringify(data));
                }
            }
        }
    }
}
