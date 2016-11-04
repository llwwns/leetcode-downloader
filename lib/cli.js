let request = require("request");
let j = request.jar();
request = request.defaults({
    jar: j,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.72 Safari/537.36 Vivaldi/1.5.648.6'
    }
});
const jsdom = require('jsdom').jsdom;
const document = jsdom('<html></html>', {});
const window = document.defaultView;
const $ = require('jquery')(window);
const fs = require('fs');
const fsp = require('fs-promise');
const progress = require('progress');
const ud = require('underscore');
const bluebird = require('bluebird');
const co = require('co');
bluebird.promisifyAll(request);

const config = JSON.parse(fs.readFileSync(`${process.env.HOME}/.leetcode`, "utf8"));

const getCookie = (cookies) => {
    let ret = {};
    for (let s of cookies) {
        [_, key, val] = s.match(/(\w+)=(\w+);/);
        ret[key] = val;
    }
    return ret;
};

const getFile = co.wrap(function*(problem) {
    let submits;
    for (let retry = 0; retry < 3; retry++) {
        let {body} = yield request.getAsync(`https://leetcode.com/problems/${problem.url}/submissions/`);
        submits = $(body).find('table[ng-app="statusPollerApp"] a.status-accepted');
        submits = submits.toArray().map((e) => $(e).attr("href"));
        if (submits.length > 0) {
            break;
        }
    }
    if (submits.length === 0) {
        console.log(`Get submit error`);
        console.log(problem);
        return;
    }
    let submit = submits[0];
    let {body} = yield request.getAsync(`https://leetcode.com${submit}`); 
    for (e of $(body).filter("script").toArray()) {
        let source = $(e).html();
        if (source.match(/submissionCode/)) {
            let data = new Function(`${source}; return pageData;`)();
            let no = problem.id.toString();
            while(no.length < 3) {
                no = `0${no}`;
            }
            let dirname = `${no}#${problem.url}`
            yield fsp.ensureDir(`leetcode-submits/${dirname}`);
            return fsp.writeFile(`leetcode-submits/${dirname}/solution.${data.getLangDisplay}`, data.submissionCode)
        }
    }
});

const getInfo = co.wrap(function*() {
    for (let retry = 0; retry < 3; retry++) {
        let {body} = yield request.getAsync("https://leetcode.com/api/problems/algorithms/");
        try {
            return obj = JSON.parse(body);
        } catch(_) {
        }
    }
});

exports.run = () => co(function*() {
    yield fsp.ensureDir('leetcode-submits');
    let res, body;
    console.log("Login");
    res = yield request.getAsync("https://leetcode.com/accounts/login/");
    let cookie = getCookie(res.headers['set-cookie']);
    res = yield request.postAsync({
        url: "https://leetcode.com/accounts/login/",
        form: {
            csrfmiddlewaretoken: cookie.csrftoken,
            login:config['username'],
            password:config['password']
        },
        headers: {
            Origin: 'https://leetcode.com',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.8',
            'Upgrade-Insecure-Requests': 1,
            'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/54.0.2840.72 Safari/537.36 Vivaldi/1.5.648.6",
            'Cache-Control': 'max-age=0',
            'Referer': 'https://leetcode.com/accounts/login/',
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            Connection: "keep-alive",
            Host: "leetcode.com"
        },
        followRedirect: false
    });
    console.log("Get info");
    let obj = yield getInfo();
    console.log(`Login as ${obj.user_name}`);
    console.log(`Solved ${obj.num_solved} / ${obj.num_total}`);
    let solved = obj.stat_status_pairs.filter((o) => o.status === "ac").map((o) => {return {
        id: o.stat.question_id,
        title: o.stat.question__title,
        url: o.stat.question__title_slug
    };});
    let bar = new progress("downloading [:bar] :percent :etas", {
        total: solved.length,
        complete: '=',
        incomplete: ' ',
        width: 20
    });
    bar.tick(0);
    while (solved.length > 0) {
        let cur = ud.first(solved, 30);
        solved = ud.rest(solved, 30);
        yield cur.map((s) => getFile(s).then(()=>{bar.tick(1);}));
    }
}).catch(console.log);
