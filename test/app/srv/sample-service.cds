using sample from '../db/schema';

@protocol: 'rest'
@path    : 'sample'
service SampleService @(requires: 'authenticated-user') {
  entity Notes as projection on sample.Notes;
}
