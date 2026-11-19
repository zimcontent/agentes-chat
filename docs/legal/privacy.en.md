# Privacy Policy

> [!warning] Draft, subject to legal review
> This document is a draft and must be reviewed by a lawyer before it is used with customers. Fields between brackets, `[to be filled]`, are company details that have not been provided yet.

Last updated on November 18, 2026.

## 1. Overview and roles

This Policy explains which personal data DougBot processes, for what purpose, for how long, with whom it is shared, and how each person can exercise their rights under Law No. 13.709/2018 (LGPD).

There are two roles, and they must be clear:

- **The customer company is the controller** of the data that people and agents put into the workspace: messages, files, tasks, wiki, agent memory, usage records and everything else that belongs to the workspace. It decides what is processed, for what purpose and who gets in.
- **The Provider is the processor** of that data: it processes workspace content only to operate the installation, following the customer company's instructions and the Data Processing Addendum in Annex I.
- **The Provider is the controller** of the account data it creates and keeps to give access to the Service (name, e-mail, credentials, sessions), and of the installation's security and operation data.

Each installation belongs to one Customer and sits on its server, in {{serverLocation}}. One Customer's data is not mixed with another's.

## 2. Data we process

**Account data, of which the Provider is controller:**

- name, e-mail address, password hash (the password itself is never stored), profile photo, and, when the person signs in with Google, Apple or GitHub, the name, e-mail and identifier that provider returns
- language, preferred time zone and the usage preferences kept for the person
- login sessions, with the IP address, the browser or app, and start and expiry times
- notification tokens for the devices the person signs in on (phone and browser)
- security records, such as sign-in attempts, emailed codes and blocks

**Workspace data, of which the customer company is controller and the Provider is processor:**

- messages in channels, conversations and direct messages, and the files, images, audio and video they carry
- tasks, wiki, calendar events, routines, boards and the widgets on dashboards
- agents: their instructions, settings, memory, skills and what each agent writes and does, with the history of tools it used
- what agents read and write in the connectors, databases and computers the workspace connects
- approvals, decisions, audit records and model usage records (model, tokens and cost, with the workspace and the agent)
- voice messages: the recorded audio and the transcribed words

**Data needed to operate and protect the installation:**

- technical logs of requests, errors and background jobs, without message content
{{#if svc.telemetry}}
- a daily anonymous usage report (counts and sizes, never messages, names, files or addresses), described in section 11
{{/if}}
{{#if svc.support}}
- the request a person sends to support, with their name and e-mail, the workspace's name, the agent that wrote it, this installation's code and the server's version, described in section 5
{{/if}}
{{#if companyRequests}}
- what a company fills in on the public waiting-list form, described in section 12
{{/if}}

## 3. How we use data, and on what legal basis

We process personal data on the following LGPD grounds:

- **Performance of a contract** (Art. 7, V): creating and keeping the account, giving access to the workspace, operating the agents, charging for the deployment where there is a charge.
- **Compliance with a legal or regulatory obligation** (Art. 7, II): keeping tax documents, answering court and administrative orders, keeping access records required by law.
- **Legitimate interest** (Art. 7, IX): keeping the installation secure, preventing abuse and fraud, fixing faults, measuring how the Service runs, which includes the anonymous usage report in section 11. The interest is in keeping the Service safe and working, the report carries only counts and sizes, and a person can object by turning it off, as section 11 explains.
- **Consent** (Art. 7, I): when the customer company or the person chooses to turn on an optional feature that involves personal data, such as voice transcription by an external service or a connected model account, and when a company joins the waiting list (section 12). Consent can be withdrawn at any time through the setting that turned it on.
- **Protection of life or health** (Art. 7, VII) and **regular exercise of rights** (Art. 7, VI): only where a concrete situation requires it, such as answering an emergency or defending a right in a proceeding.

We do not sell personal data, and the Provider does not use workspace content to train AI models. What each model provider does with what it receives, training included, follows that provider's own terms and settings, which the customer company chooses: check them before connecting an account (section 4).

## 4. What agents send to AI models

Agents use the customer company's AI accounts, contracted by it directly with each provider{{#if svc.platformKey}}, or the platform's own model key, where the server defines one and the workspace has none of its own{{/if}}. To answer, the agent sends the provider the stretch of conversation, the workspace context and the result of the tools it needs in that turn.

What the provider does with what it receives, including whether it keeps it or uses it for training, follows that provider's own terms and privacy settings, not this Policy. The customer company chooses which providers to use and can see and change that choice inside the Service.

{{#if svc.platformKey}}
In this installation the server defines a platform model key (Anthropic). A workspace with no key of its own may use it, and the router uses its small model when a workspace has no key with one. What the agent sends is the same as in the paragraph above, use is recorded per workspace, and the provider processes what it receives under its own terms.
{{/if}}

API keys and provider credentials are encrypted in the installation, are never returned to the browser or the apps, and every use is recorded with the workspace and the agent it belongs to.

## 5. Optional external services

Besides model providers, the installation may use external services. Each is turned on by an installation setting (an environment variable), and a service that was not turned on receives nothing. This section lists only those turned on in this installation; Annex II shows, one by one, whether each service is on or off.

{{#if svc.jev}}
- **The Jev router**, from TypeSafe (or through OpenRouter, when the key is its), turned on by the server's key. To decide who answers a message that called nobody, it receives the text of the conversation's recent messages, the channel and the topic. It also helps tidy agents' memory and find what they look for on screen, and receives the stretches it needs for that.
{{/if}}
{{#if svc.giphy}}
- **GIPHY**, to search GIFs. The server does the search and serves each GIF: browsers and apps never talk to GIPHY, which receives only the search term, from a person or an agent, coming from the server.
{{/if}}
{{#if svc.whatsapp}}
- **WhatsApp, through an Evolution Go gateway** turned on by the customer company. The gateway keeps only the WhatsApp sessions, in databases of its own, outside the backup in section 8. The conversations stay in the installation's database. The gateway talks to WhatsApp's servers, and using WhatsApp follows its terms. An account can be banned for that use.
{{/if}}
{{#if svc.email}}
- **Sending e-mail** through a transactional e-mail provider or an SMTP server chosen by the installation, for invitations, password resets, codes, budget alerts and approvals. The provider receives the recipient's address and name and the e-mail's text.
{{/if}}
{{#if svc.support}}
- **Support by e-mail.** When a person asks for help with the installation itself, the agent may send a summary to the installation's support address (the `contact_support` tool). The e-mail carries the report the agent wrote, the person's name and e-mail (their address is the reply-to), the workspace's name, the agent that wrote it, this installation's code and the server's version, and goes out through the e-mail provider above. Only a person can ask for it, never a routine, and each person may send at most 10 an hour. It is received by the Provider's support team, which uses it to handle the request.
{{/if}}
{{#if storageS3}}
- **File storage** in an S3-compatible service configured by the installation, which receives the Drive files, attachments, photos and recordings.
{{/if}}
{{#if storageDisk}}
- **File storage** in a folder on the server's own disk.
{{/if}}
{{#if storageDatabase}}
- **File storage** in the installation's own database, with no external service.
{{/if}}
{{#if svc.driveBackup}}
- **Copy of final videos to Google Drive.** Each final video an editor delivers is copied to a Google Drive folder the installation names.
{{/if}}
{{#if svc.media}}
- **Image and video generation** through a media service paid in credits (Zim Mídia). It receives the request and the references sent, and keeps the providers' keys and the workspace's credit wallet.
{{/if}}
{{#if svc.houseVoice}}
- **The house voice on calls** (Qwen Audio, through Empirio Labs), paid in the media service's credits. It receives the call's audio, the agent's instructions and what was said on the call while the call lasts. The key stays on the server.
{{/if}}
{{#if svc.speech}}
- **Voice transcription** through a speech service configured by the installation (AssemblyAI, ElevenLabs, Soniox, Groq, OpenAI or DeepInfra, in the order the installation tries them). It receives the voice message's audio. Agents that speak on WhatsApp with ElevenLabs send it the text they are about to say. A speech server of the installation's own, on the same network, sends nothing out.
{{/if}}
{{#if svc.push}}
- **Phone notifications**, with the notice's text and the device token, sent{{#if svc.pushDirect}} straight to Firebase Cloud Messaging (Android) and the Apple Push Notification service (iPhone), with the installation's credentials{{/if}}{{#if svc.pushRelay}}{{#if svc.pushDirect}}, and, where the installation has no credentials for a platform,{{/if}} through the agentes.chat project's notification relay, which every notice's text passes through{{/if}}.
{{/if}}
- **Browser notifications** (Web Push), encrypted and delivered by the browser's own notification service (Google, Mozilla or Apple), with the key the server generates.
{{#if svc.composio}}
- **Service integrator (Composio)**, to connect mailboxes and other apps. It receives what the connector's call needs, and the content the connector reads or sends (e-mails, for example) passes through it.
{{/if}}
- **Connectors and integrations** chosen by the customer company, such as MCP servers, GitHub, Google, Microsoft, mailboxes and databases. Each receives only what that connector's call needs and follows the connected service's terms.
{{#if svc.embeddings}}
- **Semantic search (embeddings)** through a vector service configured by the installation (Voyage AI or a server compatible with OpenAI's embeddings API), which receives the indexed stretches. If the service does not answer, search uses words alone.
{{/if}}
{{#if svc.errors}}
- **Error reports** to a Sentry-compatible server configured by the installation, from the server and, where an address is set for them, from browsers. The report carries the error, the stack, the version and internal identifiers, never message content, e-mails, IPs, cookies or tokens.
{{/if}}
{{#if svc.billing}}
- **Billing**, through a separate service. When a person opens the plan and billing page, the server hands it, in a signed link, the workspace's name and identifier, the person's identifier, name, e-mail, role and language, and usage counts (members, agents, messages, channels, files, storage). DougBot stores no card numbers.
{{/if}}
- **Hosting**: the server the installation runs on, contracted by the Provider or by the customer company, in {{serverLocation}}.
{{#if svc.telemetry}}
- **Anonymous usage report** to the DougBot project, described in section 11.
{{/if}}

The sub-processors that process data on the Customer's behalf are in Annex II, with each service, its purpose and its state.

## 6. Who sees workspace content

Workspace content is seen by the people who take part in it, according to the roles and permissions the customer company defines, and by the agents it authorizes.

The Provider's team accesses the installation only to operate and maintain it: diagnosing faults, restoring backups, applying an update or meeting a legal obligation. That access is restricted to the people who need it and is recorded. None of it is used to build profiles, advertise or train models.

## 7. How long we keep it

- **Account data:** for the life of the account. When a person asks to delete the account in the Service, sessions and devices go at once and the rest is erased 7 days later, unless they restore the account before then. Messages and records the person wrote in workspaces that go on existing stay in those workspaces, without their name as the author. Backups go within the period in section 8.
- **Workspace content:** for the life of the workspace, and earlier when someone deletes specific content. When the owner asks to delete the workspace, it closes for everyone at once and the content is erased 7 days later, unless an owner restores it before then. The workspace's files (Drive, skills, connector icons and logo) leave the installation's storage through a background job soon after; files in a bucket the workspace brought itself stay in that bucket, which is its own, and a deleted account's profile photos leave the same way. Past its date, a deletion waits while the workspace is suspended, held for a reason other than billing, or under a legal hold the installation's operator placed (to keep evidence), and happens when the hold lifts.
- **Voice messages:** {{#if voiceDays}}the audio is erased after {{voiceRetentionDays}} days. The message and the transcribed words stay.{{else}}this installation sets no period for the audio: it is kept until it is deleted, with the message and the transcribed words.{{/if}}
- **Model usage records** (tokens and cost): for the life of the workspace, because budgets and usage reports depend on them.
- **Audit log:** for the life of the workspace, because it is what shows who did what.
- **Technical logs:** {{#if logRetention}}for {{logRetention}}, the period configured in the installation{{else}}for as long as the installation's server and log collector keep them, which this installation has not stated{{/if}}.
- **Emailed codes:** valid for 10 minutes, and the rows already used go a day later.

After those periods, data is erased or anonymized, except what the law requires to be kept, such as tax documents and access records, and what is needed to defend a right in a proceeding, under Art. 16, I and II, of the LGPD.

## 8. Backups

{{#if backup}}
The installation makes one backup of the database a day, kept in a separate bucket. {{#if backupDays}}Backups are kept for {{backupRetentionDays}} days and then deleted automatically.{{else}}This installation has not stated the period: the backup service deletes those older than the period configured in it (14 days, if none is configured).{{/if}} When the customer company chooses to encrypt the backups, the reading key stays off the server.

The backup covers the database only. Files kept in a bucket or in a folder on the server{{#if svc.whatsapp}} and the WhatsApp gateway's databases (the number's sessions){{/if}} are not in it. Files kept in the database itself are.

Data deleted in the Service may remain in a backup until the period above. It is not used for anything and goes with the backup's expiry.
{{else}}
This installation has no database backup configured. If the Provider or the customer company keeps copies some other way, the agreement says how and for how long.
{{/if}}

## 9. Security

Traffic between the browser or app and the server is encrypted with TLS. Data sits on the disk of the contracted server, encrypted when the contracted infrastructure offers encryption at rest. Model, connector and database credentials are encrypted with a key derived from the installation's secret, in an envelope per credential, and are never returned to clients. Access to the installation is restricted and recorded.

If the Provider learns of a security incident that may cause relevant risk or harm to people, it tells the customer company and the affected people, and the Brazilian data protection authority (ANPD), within the deadlines the LGPD and its regulations require.

## 10. International transfers

The installation is in {{serverLocation}}. Model providers and the services in section 5 may process data in other countries, under their own terms and safeguards. When a transfer leaves Brazil, it relies on the grounds in Art. 33 of the LGPD, in particular specific contractual clauses, standard contractual clauses or the supplier's binding corporate rules.

## 11. Anonymous usage report

{{#if svc.telemetry}}
The installation sends an anonymous usage report once a day to the telemetry address of the DougBot project, from which DougBot derives. The report carries counts and sizes: how many people, agents and computers exist, which models were used and how many tokens, the sizes of the machines and how much the agents' browsers carried. It never carries messages, files, names, e-mails, addresses, paths or identifiers of people, workspaces or computers. The only identifier is a random number created at the installation's first start.

Sending is **on by default** (it is an opt-out, and does not rest on consent), and the legal basis is legitimate interest under Art. 7, IX, of the LGPD: the project's interest in knowing how the software runs so it can maintain and fix it, with data that identifies no one.
{{#if telemetryForced}}
On DougBot's own servers the report cannot be turned off.
{{else}}
To turn it off, the installation's owner sets `TELEMETRY=off` in the server's configuration or uses the switch in Settings › General. Turned off, nothing is sent. The `agentes telemetry` command shows exactly what would be sent.
{{/if}}
{{else}}
This installation sends no usage report: sending is turned off by configuration (`TELEMETRY=off`).
{{/if}}

## 12. Companies' waiting list

{{#if companyRequests}}
This installation has a public form where a company asks to join the waiting list. The form collects the person's name, e-mail, WhatsApp, company, team size, interests and any note they write, and only counts with the consent given right there (Art. 7, I). The request is recorded only after the person confirms it from the e-mail they receive.

The Provider is the controller of this data and uses it only to answer the request and arrange the contract. A request nobody confirms from the e-mail goes a few days after its link expires, never reaching the team. A confirmed request is kept for {{companyRequestsRetentionDays}} days with no activity and then erased, except one from a company the team invited or that became a client: that is the record of a relation that still stands. Whoever sent it can delete the request at any time with the delete link in the confirmation e-mail, which erases everything it holds, the consent included, or ask the data protection officer ({{dpoEmailLink}}), and can withdraw consent the same way.
{{else}}
This installation has no waiting-list form, and nothing is collected that way.
{{/if}}

## 13. Cookies and local storage

The Service uses a session cookie to keep the person signed in. The browser and the apps keep preferences on the device itself, such as language, theme, app icon and unsent message drafts. We use no advertising or cross-site tracking cookies.

## 14. Rights of the people whose data we process

The LGPD gives a person, among others, the rights to confirmation of processing, access, correction, anonymization, blocking or erasure, portability, information about sharing, information about the possibility of not consenting, and withdrawal of consent, as well as to petition the ANPD.

How to exercise each:

- **Confirmation and access:** the Service shows the profile and preferences in Settings › Your account, and the workspace content the person has access to. For an organized copy of what the installation keeps about the person, write to the data protection officer, {{dpoEmailLink}}.
- **Correction:** name, photo, time zone and language are corrected in Settings › Your account. Changing the e-mail takes a confirmation code.
- **Erasure:** a person deletes their own account in Settings › Your account, and the owner deletes the workspace in the same settings. Both can be restored until the deletion completes, 7 days later. Data in backups goes within the period in section 8, and a workspace's deletion waits while it is suspended or under a legal hold (section 7). To erase specific content, use the Service itself.
- **Portability:** ask the data protection officer for the export of the person's data, which will be delivered in a machine-readable format.
- **Information about sharing:** this Policy and Annex II say with whom data is shared. A specific request can be made to the data protection officer.
- **Withdrawing consent and objecting:** write to the data protection officer, or turn off in the Service the feature that relied on consent.
- **Complaint:** a person may complain to the ANPD (https://www.gov.br/anpd).

When a request concerns workspace content, the Provider forwards it to the customer company, which is the controller, and helps it answer, as Annex I provides. The Provider answers the requests it controls within the period the LGPD sets.

## 15. Data protection officer

The Provider's data protection officer (DPO) is {{dpo}}, and the contact is {{dpoEmailLink}}. That address is also where to write about this Policy and the Data Processing Addendum.

## 16. Children and adolescents

The Service is for people at least 18 years old. We do not knowingly collect data from children or adolescents. If it happens, tell the data protection officer, and the data will be erased.

## 17. Changes to this Policy

The Provider may change this Policy. A material change is announced with reasonable notice through the Service's channels, and the version published on this page is always the one in force. The date at the top says when it changed.

## 18. Contact

Questions, requests and complaints go to the data protection officer: {{dpo}}, {{dpoEmailLink}}.

## Annex I: Data Processing Addendum (DPA)

This Annex is part of the Terms of Use. It applies to all personal data the Provider processes on behalf of the customer company (the "Controller") while operating the DougBot installation.

**1. Subject.** The Provider processes personal data only to provide, operate, maintain, update, protect and back up the DougBot installation, and to provide the contracted support.

**2. Nature and purpose.** Processing includes storing, organizing, consulting, transmitting, encrypting, copying and erasing data, according to the Controller's instructions and its use of the Service. The Provider does not use the data for its own purpose, does not sell it and does not use it to train models.

**3. Kinds of data and data subjects.** The data is that in section 2 of this Policy, in the "workspace data" group, and the data subjects are the workspace's people, the Controller's customers and the people who appear in the content it puts into the Service.

**4. Instructions.** The Provider follows the Controller's documented instructions, including those in the Terms and in the Service's settings. If an instruction breaches the LGPD, the Provider tells the Controller and may refuse it.

**5. Confidentiality.** Anyone who accesses the data on the Provider's behalf is bound by confidentiality and accesses only what their role requires.

**6. Security.** The Provider applies the technical and administrative measures in section 9 of this Policy, and any others the agreement provides. The measures are reviewed when the risk changes.

**7. Sub-processors.** The Controller authorizes the Provider to use the services in Annex II, which receive only what their purpose requires. The Provider keeps the list up to date, tells the Controller before adding a new sub-processor that processes personal data, and answers to the Controller for each one's duties.

**8. Data subjects' rights.** The Provider helps the Controller answer data subjects' requests, through the Service's technical means and through support, and forwards to the Controller the requests it receives about workspace content.

**9. Incidents.** The Provider tells the Controller, without undue delay, of any security incident involving personal data processed on its behalf, with a description of what happened, the data and data subjects affected and the measures taken, and cooperates with the communications the Controller needs to make.

**10. Impact assessment.** When the Controller needs a data protection impact assessment, the Provider supplies the information it has about the processing it carries out.

**11. Termination.** When the agreement ends, the Provider returns or erases the personal data as the Controller chooses, except for backups for the period in section 8 of this Policy and what the law requires to be kept. When a deployment's agreement ends, its installation is shut down and its data is erased as section 7 of this Policy describes.

**12. Audit.** The Provider gives the Controller the information reasonably needed to show compliance with this Annex, including reports and answers to questionnaires, and allows audits agreed in advance, without compromising the installation's security and that of other customers.

**13. International transfers.** Where processing involves a transfer outside Brazil, the safeguards in section 10 of this Policy apply.

## Annex II: Sub-processors of this installation

The table shows, for each service, whether it is on in this installation, according to the server's settings. A service that is off receives nothing. What the Customer connects through its own settings (model providers, connectors, live voice) depends on its accounts and does not appear as on or off here. The owner's switch in Settings › General can also turn the usage report off, which this table does not see. A key the owner puts in the Service's settings (the Jev router's or GIPHY's, for example) is not seen by this table, which reads only the server's settings.

| Service | Purpose | What it receives | State |
| --- | --- | --- | --- |
| Model providers of the Customer | Answering, summarizing and routing messages | The stretch of conversation and the turn's context | According to the Customer's accounts |
| Platform model key | Answering, when the workspace has no key | The stretch of conversation and the turn's context | {{on:svc.platformKey}} |
| Jev router (TypeSafe or OpenRouter) | Choosing who answers, tidying memory | The text of recent messages, the channel and the topic | {{on:svc.jev}} |
| GIPHY | Searching GIFs | The search term | {{on:svc.giphy}} |
| WhatsApp gateway | Reading and sending WhatsApp messages | The number's conversations | {{on:svc.whatsapp}} |
| E-mail provider | Sending invitations, codes, notices and support requests | The recipient's e-mail and name, and the text | {{on:svc.email}} |
| Support by e-mail | Handling requests for help | The request, and the asker's name and e-mail | {{on:svc.support}} |
| S3 storage | Keeping Drive files and attachments | The workspace's files | {{on:storageS3}} |
| Server folder | Keeping Drive files and attachments | The workspace's files | {{on:storageDisk}} |
| Copy of videos to Google Drive | Keeping a copy of final videos | The approved final videos | {{on:svc.driveBackup}} |
| Media service (Zim Mídia) | Generating images and videos | The request and the references sent | {{on:svc.media}} |
| Voice transcription | Turning audio into text | The voice message's audio | {{on:svc.speech}} |
| Live voice | Speaking on a call | The call's audio | According to the workspace's key |
| House voice (Empirio Labs) | Speaking on a call | The call's audio | {{on:svc.houseVoice}} |
| Firebase and Apple (notifications) | Delivering the notice to the device | The notice's text and the device token | {{on:svc.pushDirect}} |
| DougBot notification relay | Delivering the notice to the device | The notice's text and the device token | {{on:svc.pushRelay}} |
| Browser notifications | Delivering the notice to the browser | The notice, encrypted | Always |
| Service integrator (Composio) | Connecting e-mail and other apps | What the connector's call needs | {{on:svc.composio}} |
| Semantic search | Finding texts by meaning | The indexed stretches | {{on:svc.embeddings}} |
| Error reports (Sentry) | Diagnosing faults | The error, the stack and the version | {{on:svc.errors}} |
| Anonymous usage report | Measuring how the project runs | Counts and sizes, never content | {{on:svc.telemetry}} |
| Billing service | Charging for the deployment, where there is one | Account data and usage counts | {{on:svc.billing}} |
| Database backup | Restoring the installation | The database, without bucket files | {{on:backup}} |
| Hosting | Keeping the installation running | Everything the installation keeps | Always |

This installation's retention periods, to complete section 7 of this Policy: {{#if logRetention}}technical logs for {{logRetention}}{{else}}technical logs for as long as the server and the collector keep them{{/if}}{{#if backup}}{{#if backupDays}}, backups for {{backupRetentionDays}} days{{/if}}{{/if}}{{#if voiceDays}}, voice audio for {{voiceRetentionDays}} days{{else}}, voice audio until deleted{{/if}}.
