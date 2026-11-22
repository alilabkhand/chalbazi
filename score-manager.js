(function(global) {
    var FIREBASE_DB_URL = 'https://chalbazi-word-default-rtdb.firebaseio.com';
    var SCORES_ROOT = FIREBASE_DB_URL.replace(/\/+$/, '') + '/chalbaziScores';
    var PERSIAN_MONTHS = ['', 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

    function safeGet(k, fb) { try { return localStorage.getItem(k) || fb; } catch (e) { return fb; } }
    function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function pad2(n) { return n < 10 ? '0' + n : String(n); }

    // تبدیل دقیق میلادی به شمسی (بدون وابستگی به مرورگر)
    function toJalali(gy, gm, gd) {
        var g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        var gy2 = (gm > 2) ? (gy + 1) : gy;
        var days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
        var jy = -1595 + (33 * Math.floor(days / 12053));
        days %= 12053;
        jy += 4 * Math.floor(days / 1461);
        days %= 1461;
        if (days > 365) {
            jy += Math.floor((days - 1) / 365);
            days = (days - 1) % 365;
        }
        var jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
        var jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
        return { jy: jy, jm: jm, jd: jd };
    }

    // محاسبه کلیدهای روزانه، هفتگی (از شنبه) و ماهانه به وقت رسمی تهران (UTC+3:30)
    function getPeriodKeys() {
        var tehranMs = Date.now() + (210 * 60 * 1000);
        var d = new Date(tehranMs);
        var jToday = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

        // محاسبه ابتدای هفته ایران (شنبه)
        var dow = d.getUTCDay(); // 0=یکشنبه ... 6=شنبه
        var daysSinceSat = (dow + 1) % 7;
        var satDate = new Date(tehranMs - (daysSinceSat * 86400000));
        var jSat = toJalali(satDate.getUTCFullYear(), satDate.getUTCMonth() + 1, satDate.getUTCDate());

        var dayKey = jToday.jy + '-' + pad2(jToday.jm) + '-' + pad2(jToday.jd);
        var weekKey = 'w_' + jSat.jy + '-' + pad2(jSat.jm) + '-' + pad2(jSat.jd);
        var monthKey = jToday.jy + '-' + pad2(jToday.jm);

        return {
            daily: dayKey,
            weekly: weekKey,
            monthly: monthKey,
            all: 'all',
            labels: {
                daily: 'امروز (' + jToday.jd + ' ' + PERSIAN_MONTHS[jToday.jm] + ')',
                weekly: 'این هفته (از شنبه ' + jSat.jd + ' ' + PERSIAN_MONTHS[jSat.jm] + ')',
                monthly: 'ماه ' + PERSIAN_MONTHS[jToday.jm] + ' ' + jToday.jy,
                all: 'مجموع کل تاریخچه'
            }
        };
    }

    function getQueryParam(name) {
        try {
            var p = new URLSearchParams(window.location.search);
            return p.get(name) || '';
        } catch (e) { return ''; }
    }

    // شناسایی یکپارچه اکانت بازیکن در تمام صفحات
    function getUser() {
        var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
        if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
            var u = tg.initDataUnsafe.user;
            return {
                id: 'tg_' + u.id,
                rawId: String(u.id),
                name: [u.first_name, u.last_name].filter(Boolean).join(' ') || ('کاربر ' + u.id),
                isTelegram: true
            };
        }
        var qUid = getQueryParam('tg_uid');
        var qName = getQueryParam('tg_name');
        if (qUid) {
            return {
                id: 'tg_' + qUid,
                rawId: String(qUid),
                name: qName || ('کاربر ' + qUid),
                isTelegram: true
            };
        }
        var savedUid = safeGet('chalbazi_uid', '');
        if (!savedUid) {
            savedUid = String(Date.now()).slice(-6) + '_' + Math.floor(Math.random() * 999);
            safeSet('chalbazi_uid', savedUid);
        }
        return {
            id: 'u_' + savedUid,
            rawId: savedUid,
            name: safeGet('chalbazi_guest_name', 'بازیکن چالبازی'),
            isTelegram: false
        };
    }

    function getPeriodUrl(period, keys) {
        if (period === 'all') return SCORES_ROOT + '/all';
        return SCORES_ROOT + '/' + period + '/' + keys[period];
    }

    // صف ثبت متوالی تا در امتیازهای پیاپی تداخل ایجاد نشود
    var writeQueue = Promise.resolve();

    function addScore(points, gameId, eventId) {
        var pts = Math.floor(Number(points) || 0);
        if (pts <= 0) return Promise.resolve(false);

        var user = getUser();
        if (eventId) {
            var dedupeKey = 'cs_evt_' + user.id + '_' + eventId;
            if (safeGet(dedupeKey, '') === '1') return Promise.resolve(false);
            safeSet(dedupeKey, '1');
        }

        writeQueue = writeQueue.then(function() {
            var keys = getPeriodKeys();
            var periods = ['daily', 'weekly', 'monthly', 'all'];
            var tasks = periods.map(function(period) {
                var url = getPeriodUrl(period, keys) + '/' + user.id + '.json';
                return fetch(url)
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(existing) {
                        var currentScore = (existing && typeof existing.score === 'number') ? existing.score : 0;
                        var gamesObj = (existing && existing.games) ? existing.games : {};
                        if (gameId) {
                            gamesObj[gameId] = (gamesObj[gameId] || 0) + pts;
                        }
                        return fetch(url, {
                            method: 'PUT',
                            body: JSON.stringify({
                                name: user.name,
                                score: currentScore + pts,
                                games: gamesObj,
                                updatedAt: Date.now()
                            })
                        });
                    })
                    .catch(function() {});
            });
            return Promise.all(tasks);
        }).catch(function() {});

        return writeQueue;
    }

    // دریافت مجموع امتیازات روزانه، هفتگی، ماهانه و کلی خود بازیکن
    function getMyStats() {
        var user = getUser();
        var keys = getPeriodKeys();
        var periods = ['daily', 'weekly', 'monthly', 'all'];
        var result = { daily: 0, weekly: 0, monthly: 0, all: 0, labels: keys.labels };

        var tasks = periods.map(function(period) {
            var url = getPeriodUrl(period, keys) + '/' + user.id + '.json';
            return fetch(url)
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data && typeof data.score === 'number') {
                        result[period] = data.score;
                    }
                })
                .catch(function() {});
        });

        return Promise.all(tasks).then(function() { return result; });
    }

    // دریافت لیدربورد بر اساس بازه (daily | weekly | monthly | all)
    function getLeaderboard(period, limit) {
        var lim = limit || 20;
        var user = getUser();
        var keys = getPeriodKeys();
        var url = getPeriodUrl(period, keys) + '.json';

        return fetch(url)
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                var list = [];
                if (data) {
                    var ids = Object.keys(data);
                    for (var i = 0; i < ids.length; i++) {
                        var id = ids[i];
                        var item = data[id];
                        if (item && typeof item.score === 'number' && item.score > 0) {
                            list.push({
                                id: id,
                                name: item.name || 'بازیکن',
                                score: item.score,
                                isMe: id === user.id
                            });
                        }
                    }
                }
                list.sort(function(a, b) { return b.score - a.score; });

                var myRank = 0;
                var myScore = 0;
                for (var j = 0; j < list.length; j++) {
                    if (list[j].id === user.id) {
                        myRank = j + 1;
                        myScore = list[j].score;
                        break;
                    }
                }

                return {
                    period: period,
                    label: keys.labels[period],
                    top: list.slice(0, lim),
                    totalPlayers: list.length,
                    myRank: myRank,
                    myScore: myScore
                };
            })
            .catch(function() {
                return { period: period, label: keys.labels[period], top: [], totalPlayers: 0, myRank: 0, myScore: 0, error: true };
            });
    }

    global.ChalbaziScore = {
        getUser: getUser,
        getPeriodKeys: getPeriodKeys,
        addScore: addScore,
        getMyStats: getMyStats,
        getLeaderboard: getLeaderboard
    };
})(window);
