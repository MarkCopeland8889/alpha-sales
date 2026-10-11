<!-- Source document as provided by Mark on 2026-10-11. Kept verbatim for reference. -->

I. Blueprint 

Alpha-Sales Blueprint
Overview:
Use cases, purpose, and long term vision
Foundations and Architecture
Basic environment variables
Version and Syncd
Computers
Browsers & Softwares
Profile Management 
Proxies 
Extensions
History 
Cookies 
Account Management
AI 
Scrapers 
Platform Workflows 
Larger Schedules 
Guardrails & Debug
Platforms & Support 
Flows

Use Cases, Purpose, and Long Term Vision
Alpha-Sales is a sales algorithm that helps get new clients, create better content, and discover business ideas. It starts with an AI hub and file storage center that helps take a business idea or a problem and break it down into who the audience is, and where they most often speak. These places are on the internet, and for most they are easily accessible. 

One of the biggest constraints though is security. Most of the places on the internet that are going to be used for client acquisition are locked with identity checkers, CAPTCHAs, and more. We will solve that problem. 

Beyond that, Alpha-Sales can also be used for product generation, hosting, and testing due to AI development tools, but that has to be closely monitored by real humans. Alpha-Sales can 

We can break the use cases into 4 distinct categories: 
1. Business Idea Generator and/or Validator 
2. Client Acquisition & Research
3. Content Generation
4. Product Development 

NOTE: The contents of THIS Document tab may just represent a version of the product or a prototype, not the final result. This will most likely take weeks to fully map out and develop

Systems and Processes

The purpose of this document is to assist us in the development of this tool. However, this document should also be complete enough that it can be given to a large language model and have it develop a similar prototype. 

A short warning: I am a thinker and planner, and everything I write in this document is to be followed religiously. However, I have very little coding skills, meaning regarding some of the exact functions and architecture, there may be better more efficient ways of doing things, and don’t be afraid to suggest better ways

(Come Back Here)

Overview
Section I: Foundations
Terminology 
Scraper: a set of instructions for playwright or puppeteer that also combines AI requests to independently take actions on a specific website or set of websites. 
Job: A set of scrapers and settings that can be ran to complete a certain task. It would do scraper one then scraper two, or both at the same time, or switch when the website task changes but is still on the same website.
Computers and management: this application should be able to delegate jobs to other computers connected to the same application. 

Repositories

Google Drive: https://drive.google.com/drive/folders/1TFNRUTKC04Z13OWaQ9SIgqbAMvKzoqsC?usp=sharing
Invisible-Playwright (A stealth Playwright Firefox version): https://github.com/feder-cr/invisible_playwright 
Camoufox:
https://github.com/daijro/camoufox
VulpineOS: https://github.com/VulpineOS/VulpineOS
Puppeteer Extra Plugin Stealth: https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth

Environment Variables 
Google OAUTH
R-clone
Locations fro chrome profiles: profiles/chrome, locatinos for Firefox profiles: profiles/firefox

Repository Setup

Google Drive Folders: 
Accounts
Profiles 
Firefox 
Chrome
Configurations
Invisible Playwright
Camoufox
Scrapers
Local Files 
Archive
Logs

Local Project Folders:
In gitignore:
Accounts
Profiles 
Configurations
Scrapers
Local Files 
Log
Software
(This single file is excluded from gitignore) List of Software Installations & Commands
Frameworks
Extension Copies
Firefox 
Chrome 

Installed Software & Packages: 
Prerequisites:
AHK2 must be installed on the user’s machine. 
Inside Software folder: 
Chrome 
Firefox
Camoufox
VulcanOS
Invisible-Playwright 

Inside Extension Copies folder:
Chrome
ChatGPT extension 
Playwright extension
Playwright CRX
Firefox
ChatGPT extension 
Playwright extension
Playwright CRX
Extra Packages
r-clone
Codex
AGY (antigravity)
Claude
Opencode zen 
Jev by TypeSafe
Playwright 
Pupetteer 
Pupetteer extra playwright stealth

Core Functions
This section outlines core features that need to be implemented throughout the whole project.

Running Commands
This project should have a reliable way to run commands to powershell, and administrator commands from directly inside the code

Debugging
Debug/Log collection system, through helper js file and log() (you can find a better name) functions: 
Contains
State (✅/⚠️/❌)
Simple or advanced 
Regardless of type or state, saved to run file in logs folder with specific time and date attached


File Storage & DB
Files and environment variables should be stored in the cloud so they can be accessed by other computers. For now, we can use Google Drive as a simple data sink. 

Should have a simple file folder in Google Drive that is connected, with a subfolder template that is copied into a folder that contains the name of each corresponding account. The subfolders should be the list of subfolders 
Profiles 
Configurations
Scrapers
Local Files 
We use r-clone to back up to the cloud edits on profiles, configurations, scrapers, and local files whenever they happened, and write the last edit date to the Supabase DB. Whenever the app is launched, we use r-clone to update files on our computer that have been already updated in the cloud. 

Supabase database, with basic functionality read write fetch:
Online DB: 
Account and password. Each item here is nested under its corresponding account 
Devices logged into same account: 
Device names, 
machine IDs, 
last corresponding app version
Last edit date. 
Status
Last heartbeat
Projects
Jobs 
Last heartbeat
Status
Machine ID
Proxies 
Type: socks5, socks4, http, https
Host
Port 
Username
Password
Status checks (bucket)
Website name(s)
Website status(es): working, restricted (means website works and loads but certain functions don’t), blocked
Website status reason

R-CLONE: Functions for update() specific file that has been edited, check() (scan all files) for issues -> update, update() for new versions (which re-writes the older version), archive.exist() to move file in drive to archive folder, archive.new() to upload local file/folder to archive before deletion. Possibly archive.new() will not be needed. So specific file edit = check() -> if file different -> update, specific file deletion = check() -> search for file in drive, if exist -> archive.exist(), else -> archive.new(). 


Computers & Management
With many different scrapers, research tools, accounts, browsers, and LLMs running at the same time, running this on a personal computer that may disconnect or be shutoff may cause complications long term. It would be better to have a dedicated server to run this on and to be able to delegate jobs and more things to this computer.

Whenever a computer logs onto this application once downloaded, it should store its machine name, version running, and machine ID onto the database under the account its logged into. 
Computers cannot delegate between each other if they are not on the same version. 



Heartbeat & Status 
There is a line in the online DB that is listed status and another that is listed last heartbeat under devices logged into the same account. The one that says last heartbeat is the last date of the signal sent. There is a function that starts as the last thing on login and continues until the close of the application, which updates the time and date of last heartbeat every 30 seconds, as well as the status. Later, we will specify how the application receives statuses, which can be either available, busy, draining, updating, error, or maintenance, and our application will read from the DB to determine what machines are online and working, and what are not. 


Version & Sync
Versions should remain consistent across usable computers to avoid bugs. 
The codebase should be saved to a Git repository that exists somewhere
Whenever the application is logged into, it should read its application version, and write it to the server. 
There should be a quick update command that works inside the application or in the application terminal that updates the application. 

Login

Simple UI with a Login with Google button that initiates login. 
Google login, for the DB if a signup is successful a new (I’m going to call it a bucket because I don’t know the right name for it) a new bucket is created. When a new bucket is created, a new subbucket for the machine accessing is created according to the earlier online DB template, and the device name and machine id is fetched and saved to db. 
Should have update() function to be able to with R-clone check() -> fan out -> update() for all files
Login process: Log login date, start app, write app version to db, write status and heartbeat. Then run function update() 

Browsers & Software 
The repo should have the needed browsers installed inside the repository, not rely on outside software. The default install list is Chrome, Firefox, Camoufox, VulpineOS and Invisible Playwright. Invisible Playwright is a new stealth playwright firefox version that passes many tests

All 5 of the installed browsers should be launchable from the code
Any one of the five installed browsers, or aunty browser installed, should have a function that allows it to load a specific profile, combined with optional a specific proxy and specific anti-detect configuration
Vulpine OS is Camoufox with features for AI agents that save tokens. It should be treated like Camoufox and have the same available functions.

J. Profiles 
A profile is a folder of data a browser uses when taking actions. Each of the browsers can be configured to store a profile as a folder in this format: Profiles / (Browser name) / (Profile name). Invisible playwright will need to use persistent mode but yes. 

Extensions can be installed into profiles. This is a key feature. 

When a profile is loaded, we should be able to inject proxies and for some configurations. 

K. Proxies 
Proxies are stored inside the online Supabase database. 


L. Configurations
Camoufox stores configurations using config files, but they can be overridden or randomly generated. They will be stored inside a Configuration folder. However, Invisible playwright uses a seed, and each seed can be stored inside its own small json file. 

M. Accounts
There are two types of accounts that will be used: 1, web accounts, which are specific profiles with login cookies and data that are used for certain purposes within the application. 2, OAUTH accounts which are CLI logins for certain direct applications. Those are stored in Accounts / (Platform Name) / (username 1), (username 2), etc. 
N. Scrapers
A scraper is a stored set of instructions that involves a specific site and is ran to take certain actions there. The scraper has certain checkpoints, where the progress is stored, and that is saved to the Supabase DB. 
Section 2: Management & Functionality Across 3rd Party Platforms
O. AI
AI Will be accessed both through web accounts as well as CLI access. 
Functions:
Chat Completions
Plugin injections (ex. @Create-image)
Model Picker & Reasoning Levels
Attach files 
Deep research
Create video 
Create music 
Attach canvas
Copy Chat 
Copy code snippet in chat
Download image
Download multi-image set 
Download generated file
Retry 
Fork 
Gemini spark action
Codex cloud
Location
Temporary Chat
Inside project 
Inside folder/organization system 
Create project
Delete chat 
Move chat
Providers supported 
Codex
Antigravity 
z.ai
Opencode zen
Ollama 
Typescript Jev 
Gemini API 
Chatgpt.com (via scraper) 
gemini.com (via scraper)
Google.com (via scraper)
Scraper details: contains all the functions listed above for each provider, except for create video, create music, gemini spark action which are specific to gemini.com
P. Dynamic AI Scraping Agent
The purpose of this is to build a low cost cheap AI agent that is able to scrape and navigate sites that haven’t been trained before. We could specifically use VulcanOS for this. More on this later.
