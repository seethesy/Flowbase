// A synthetic events sheet for the Events importer (FLOW-299). No sanitized
// sample of the real sheet exists yet, so this follows the importer's working
// layout (shared/import-events.ts). Invented values only (ADR-27).
export const eventsCsv = [
  "Event,Date,Start Time,Status,Client,Contact,Email,Phone,Guests,Venue,Event Type,Notes",
  // 2: an early lead: lead and event, no client.
  "Sample Spring Social,2027-04-10,6:30 PM,Pitching,,Sample Person One,one@example.com,2025550111,80,Sample Hall,Social,Wants a taco bar",
  // 3: Closing creates the client, an organization with its contact.
  "Sample Gala,5/22/2027,18:00,Closing,Sample Org,Sample Person Two,two@example.com,2025550112,\"1,200\",Sample Ballroom,Gala,",
  // 4: Closed, a person client; no start time (noon, flagged).
  "Sample Wedding,2027-09-18,,Closed,Sample Person Three,,,2025550113,150,,Wedding,",
  // 5: Lost.
  "Sample Picnic,2027-06-01,11:00 AM,Lost,,Sample Person Four,four@example.com,,40,Sample Park,Picnic,",
  // 6: blank status starts at Inquiry.
  "Sample Lunch,2027-03-03,12:30,,,Sample Person Five,five@example.com,,12,,Corporate,",
  // 7: errors: no date, a bad status.
  "Sample Broken,,,Maybe,,Sample Person Six,,,,,,",
].join("\r\n");
