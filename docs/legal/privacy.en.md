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

Each installation belongs to one Customer and sits on its server, in `{{serverLocation}}`. One Customer's data is not mixed with another's.

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
- when turned on, a daily anonymous usage report (counts and sizes, never messages, names, files or addresses), described in section 11

## 3. How we use data, and on what legal basis

We process personal data on the following LGPD grounds:

- **Performance of a contract** (Art. 7, V): creating and keeping the account, giving access to the workspace, operating the agents, charging for the deployment where there is a charge.
- **Compliance with a legal or regulatory obligation** (Art. 7, II): keeping tax documents, answering court and administrative orders, keeping access records required by law.
- **Legitimate interest** (Art. 7, IX): keeping the installation secure, preventing abuse and fraud, fixing faults, measuring how the Service runs. The interest is in keeping the Service safe and working, and processing is limited to what that requires.
- **Consent** (Art. 7, I): when the customer company or the person chooses to turn on an optional feature that involves personal data, such as the usage report, voice transcription by an external service, or a connected model account. Consent can be withdrawn at any time through the setting that turned it on.
- **Protection of life or health** (Art. 7, VII) and **regular exercise of rights** (Art. 7, VI): only where a concrete situation requires it, such as answering an emergency or defending a right in a proceeding.

We do not sell personal data and do not use workspace content to train AI models.

## 4. What agents send to AI models

Agents use the AI accounts contracted by the customer company directly with each provider. To answer, the agent sends the chosen provider the stretch of conversation, the workspace context and the result of the tools it needs in that turn.

What the provider does with what it receives follows that provider's own terms and privacy settings, not this Policy. The customer company chooses which providers to use and can see and change that choice inside the Service.

API keys and provider credentials are encrypted in the Customer's installation, are never returned to the browser or the apps, and every use is recorded with the workspace and the agent it belongs to.

## 5. Optional external services

Besides model providers, the installation may use external services. Each is turned on by the installation's configuration (an environment variable), and a service that was not turned on receives nothing. They are:

- **WhatsApp, through an Evolution Go gateway** turned on by the customer company. The gateway keeps only the WhatsApp sessions. The conversations stay in the installation's database. The gateway talks to WhatsApp's servers, and using WhatsApp follows its terms. An account can be banned for that use.
- **Sending e-mail** through a transactional e-mail provider or an SMTP server chosen by the customer company, for invitations, password resets, budget alerts and approvals.
- **File storage** in an S3-compatible service or in a directory on the server itself. With neither, files stay in the installation's database.
- **Image and video generation** through a media service paid in credits, which keeps the providers' keys and the workspace's credit wallet.
- **Live voice** through the model provider's voice API, with the workspace's own key.
- **Voice transcription** through a speech service configured by the installation, or through a speech server of its own on the same network.
- **Phone notifications** sent through Firebase Cloud Messaging, the Apple Push Notification service or a notification relay, as the installation is configured.
- **Connectors and integrations** chosen by the customer company, such as MCP servers, GitHub, Google, Microsoft, mailboxes, databases and a service integrator. Each receives only what that connector's call needs and follows the connected service's terms.
- **Semantic search (embeddings)** through a vector service configured by the installation, when turned on. Turned off, search uses words alone.
- **Error reports** to a Sentry-compatible server configured by the installation. The report carries the error, the stack, the version and internal identifiers, never message content, e-mails, IPs, cookies or tokens.
- **Payment and billing**, when the customer company contracts one, through a separate billing service. DougBot stores no card numbers.
- **Hosting**: the server the installation runs on, contracted by the Provider or by the customer company, in `{{serverLocation}}`.

The list of sub-processors in use in this installation, with each service and its purpose, is in Annex II. Whoever installs fills it in and updates it when a service is turned on or off.

## 6. Who sees workspace content

Workspace content is seen by the people who take part in it, according to the roles and permissions the customer company defines, and by the agents it authorizes.

The Provider's team accesses the installation only to operate and maintain it: diagnosing faults, restoring backups, applying an update or meeting a legal obligation. That access is restricted to the people who need it and is recorded. None of it is used to build profiles, advertise or train models.

## 7. How long we keep it

- **Account data:** for the life of the account. When a person asks to delete the account in the Service, sessions and devices go at once and the rest is erased 7 days later, unless they restore the account before then. Backups go within the period in section 8.
- **Workspace content:** for the life of the workspace, and earlier when someone deletes specific content. When the owner asks to delete the workspace, it closes for everyone at once and the content is erased 7 days later, unless an owner restores it before then.
- **Voice messages:** the audio is erased after `{{voiceRetentionDays}}` days (90 by default). The message and the transcribed words stay.
- **Model usage records** (tokens and cost): for the life of the workspace, because budgets and usage reports depend on them.
- **Audit log:** for the life of the workspace, because it is what shows who did what.
- **Technical logs:** for `{{logRetention}}`, the period configured in the installation, which is stated in Annex II.
- **Emailed codes:** valid for 10 minutes, and the rows already used go a day later.

After those periods, data is erased or anonymized, except what the law requires to be kept, such as tax documents and access records, and what is needed to defend a right in a proceeding, under Art. 16, I and II, of the LGPD.

## 8. Backups

The installation makes one backup of the database a day, kept in a separate location. Backups are kept for `{{backupRetentionDays}}` days (14 by default) and then deleted automatically. When the customer company chooses to encrypt the backups, the reading key stays off the server.

Data deleted in the Service may remain in a backup until the period above. It is not used for anything and goes with the backup's expiry.

## 9. Security

Traffic between the browser or app and the server is encrypted with TLS. Data sits on the disk of the contracted server, encrypted when the contracted infrastructure offers encryption at rest. Model, connector and database credentials are encrypted with a key derived from the installation's secret, in an envelope per credential, and are never returned to clients. Access to the installation is restricted and recorded.

If the Provider learns of a security incident that may cause relevant risk or harm to people, it tells the customer company and the affected people, and the Brazilian data protection authority (ANPD), within the deadlines the LGPD and its regulations require.

## 10. International transfers

The installation is in `{{serverLocation}}`. Model providers and the optional services in section 5 may process data in other countries, under their own terms and safeguards. When a transfer leaves Brazil, it relies on the grounds in Art. 33 of the LGPD, in particular specific contractual clauses, standard contractual clauses or the supplier's binding corporate rules.

## 11. Anonymous usage report

The installation may send an anonymous usage report once a day to the telemetry address of the agentes.chat project, from which DougBot derives. The report carries counts and sizes: how many people, agents and computers exist, which models were used and how many tokens, the sizes of the machines and how much the agents' browsers carried. It never carries messages, files, names, e-mails, addresses, paths or identifiers of people, workspaces or computers. The only identifier is a random number created at the installation's first start.

Sending it is optional. It is turned off by the installation's configuration (`TELEMETRY=off`) or by the switch in Settings › General, available to the installation's owner. Turned off, nothing is sent. The `agentes telemetry` command shows exactly what would be sent.

## 12. Cookies and local storage

The Service uses a session cookie to keep the person signed in. The browser and the apps keep preferences on the device itself, such as language, theme, app icon and unsent message drafts. We use no advertising or cross-site tracking cookies.

## 13. Rights of the people whose data we process

The LGPD gives a person, among others, the rights to confirmation of processing, access, correction, anonymization, blocking or erasure, portability, information about sharing, information about the possibility of not consenting, and withdrawal of consent, as well as to petition the ANPD.

How to exercise each:

- **Confirmation and access:** the Service shows the profile and preferences in Settings › Your account, and the workspace content the person has access to. For an organized copy of what the installation keeps about the person, write to the data protection officer, `{{dpoEmail}}`.
- **Correction:** name, photo, time zone and language are corrected in Settings › Your account. Changing the e-mail takes a confirmation code.
- **Erasure:** a person deletes their own account in Settings › Your account, and the owner deletes the workspace in the same settings. Both can be restored until 7 days before the deletion completes. To erase specific content, use the Service itself.
- **Portability:** ask the data protection officer for the export of the person's data, which will be delivered in a machine-readable format.
- **Information about sharing:** this Policy and Annex II say with whom data is shared. A specific request can be made to the data protection officer.
- **Withdrawing consent and objecting:** write to the data protection officer, or turn off in the Service the feature that relied on consent.
- **Complaint:** a person may complain to the ANPD (https://www.gov.br/anpd).

When a request concerns workspace content, the Provider forwards it to the customer company, which is the controller, and helps it answer, as Annex I provides. The Provider answers the requests it controls within the period the LGPD sets.

## 14. Data protection officer

The Provider's data protection officer (DPO) is `{{dpo}}`, and the contact is `{{dpoEmail}}`. That address is also where to write about this Policy and the Data Processing Addendum.

## 15. Children and adolescents

The Service is for people at least 18 years old. We do not knowingly collect data from children or adolescents. If it happens, tell the data protection officer, and the data will be erased.

## 16. Changes to this Policy

The Provider may change this Policy. A material change is announced with reasonable notice through the Service's channels, and the version published on this page is always the one in force. The date at the top says when it changed.

## 17. Contact

Questions, requests and complaints go to the data protection officer: `{{dpo}}`, `{{dpoEmail}}`.

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

Whoever installs DougBot fills in this list and updates it when a service is turned on or off. A service not listed here is not turned on in this installation.

| Service | Purpose | What it receives | Turned on? |
| --- | --- | --- | --- |
| Model providers contracted by the Customer | Answering, summarizing and routing messages | The stretch of conversation and the turn's context | `{{modelProviderName}}` |
| WhatsApp gateway | Reading and sending WhatsApp messages | The number's conversations | `{{whatsappGateway}}` |
| E-mail provider | Sending invitations, codes and notices | The recipient's e-mail and name | `{{emailProvider}}` |
| File storage | Keeping Drive files and attachments | The workspace's files | `{{storageProvider}}` |
| Media service | Generating images and videos | The request and the references sent | `{{mediaProvider}}` |
| Live voice | Speaking on a call | The call's audio | `{{liveVoiceProvider}}` |
| Voice transcription | Turning audio into text | The voice message's audio | `{{speechProvider}}` |
| Phone notifications | Delivering the notice to the device | The notice's text and the device token | `{{pushProvider}}` |
| Service integrator | Connecting e-mail and other apps | What the connector's call needs | `{{integratorProvider}}` |
| Semantic search | Finding texts by meaning | The indexed stretches | `{{embeddingsProvider}}` |
| Error reports | Diagnosing faults | The error, the stack and the version | `{{errorProvider}}` |
| Anonymous usage report | Measuring how the project runs | Counts and sizes, never content | `{{telemetryProvider}}` |
| Billing service | Charging for the deployment, where there is one | The Customer's billing data | `{{billingProvider}}` |
| Hosting | Keeping the installation running | Everything the installation keeps | `{{hostingProvider}}` |

This installation's retention periods, to complete section 7 of this Policy: technical logs for `{{logRetention}}`, backups for `{{backupRetentionDays}}` days, voice audio for `{{voiceRetentionDays}}` days.
