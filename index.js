const { TelegramClient } = require("messaging-api-telegram");
const moment = require("moment-timezone");
const fetch = require("node-fetch");
const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const interval = 1000 * 30; // 1 minute
const district_id = process.env.DISTRIC_ID;
const db_url = process.env.FIREBASE_REALTIME_DB_URL;

const client = new TelegramClient({
    accessToken: process.env.BOT_ACCESS_TOKEN
});

const today = moment().format("DD-MM-yyyy");

const sendMessage = async(message) => {
    if (!message) {
        return;
    }
    const userIds = (process.env.TELEGRAM_USERS || "")
        .split(",")
        .map((x) => parseInt(x));

    console.log(userIds);
    if (!userIds.length) {
        throw new Error("Atleast one telegram user is required");
    }
    const promises = userIds.map((x) => client.sendMessage(x, message));

    await Promise.all(promises);
};

const fetchTodayData = async() => {
    try {
        const response = await fetch(
            `${db_url}/cowin/${district_id}/${today}.json`
        ).then((x) => x.json());
        return response;
    } catch (err) {
        console.log(err);
    }
};

const saveTodayData = async(data) => {
    try {
        await fetch(`${db_url}/cowin/${district_id}/${today}.json`, {
            method: "PUT",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(data)
        }).then((x) => x.json());
    } catch (err) {
        console.log(err);
    }
};

const fetchTodayVaccineData = async(district_id) => {
    try {
        const url = `https://cdn-api.co-vin.in/api/v2/appointment/sessions/public/findByDistrict?district_id=${district_id}&date=${today}`;
        const response = await fetch(url, {
            headers: {
                Accept: "*/*",
                "User-Agent": "PostmanRuntime/7.26.8",
                Host: "cdn-api.co-vin.in"
            }
        }).then((x) => x.json());

        const centers = response.sessions.filter((x) => x.available_capacity > 0);
        return centers.sort((a, b) => b.available_capacity - a.available_capacity);
    } catch (err) {
        return [];
    }
};

const formatMessage = (data) => {
    return data
        .map(
            (x) =>
            `Center : ${x.name}\nAddress : ${x.address}\nAvailable Capacity : ${x.available_capacity}\nAge Limit : ${x.min_age_limit}\nVaccine : ${x.vaccine}`
        )
        .join("\n\n");
};

const startPolling = async() => {
    const todayData = await fetchTodayData();
    const availableCenters = await fetchTodayVaccineData(district_id); //161 for PATAN
    await saveTodayData(availableCenters);

    console.log(`Scrapped at ${moment().format()} : ${availableCenters.length}`);

    if (!todayData) {
        await sendMessage(formatMessage(availableCenters));
        return;
    }

    if (todayData.length) {
        const output = [];
        for (var center of availableCenters) {
            const matchedCenter = todayData.find(
                (x) => x.center_id === center.center_id
            );
            if (!matchedCenter) {
                output.push(center);
            } else if (
                matchedCenter.available_capacity !== center.available_capacity
            ) {
                output.push(matchedCenter);
            }
        }

        await sendMessage(formatMessage(output));

        return;
    }
};

const pingServer = () => {
    const PING_URL = process.env.PING_URL;

    // PING_INTERVAL in env will be in minutes
    // Default is 25 minutes
    const PING_INTERVAL = Number(process.env.PING_INTERVAL || 25) * (1000 * 60);

    if (!PING_URL) {
        return;
    }

    const awake = async() => {
        try {
            await fetch(PING_URL);
            console.log("ping done");
            setTimeout(awake, PING_INTERVAL);
        } catch (err) {
            setTimeout(awake, PING_INTERVAL);
        }
    };

    setTimeout(awake, 0);
};

(async() => {
    const app = express();

    const port = process.env.PORT || 8080;

    const polling = async() => {
        try {
            await startPolling();
            setTimeout(polling, interval);
        } catch (err) {
            console.log(err);
            setTimeout(polling, interval);
        }
    };

    await polling();

    // pingServer()

    app.listen(port, () => {
        console.log(`Service is started  on port ${port}`);
    });
})();