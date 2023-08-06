import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";

const Popup = () => {
	const [count, setCount] = useState(0);
	const [currentURL, setCurrentURL] = useState<string>();

	useEffect(() => {
		chrome.browserAction.setBadgeText({ text: count.toString() });
	}, [count]);

	useEffect(() => {
		chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
			setCurrentURL(tabs[0].url);
		});
	}, []);

	const observeSpeakers = () => {
		chrome.runtime.sendMessage({ type: "OBSERVE_SPEAKERS" });
	};

	const record = () => {
		chrome.runtime.sendMessage({ type: "RECORD" });
	};

	return (
		<>
			<ul style={{ minWidth: "700px" }}>
				<li>Current URL: {currentURL}</li>
				<li>Current Time: {new Date().toLocaleTimeString()}</li>
			</ul>
			<button
				onClick={() => record()}
				style={{ marginRight: "5px" }}
			>
				record
			</button>
			<button onClick={observeSpeakers}>observespeakers</button>
		</>
	);
};

ReactDOM.render(
	<React.StrictMode>
		<Popup />
	</React.StrictMode>,
	document.getElementById("root")
);
