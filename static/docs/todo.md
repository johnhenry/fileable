
## Todo

- remove unnecessary dependencies
- add proper typescript typeings
- test multiple scenarious:
     - local input + remote templated
     - local input + local templated
     - remote input + remote templated
     - local input + local templated
     - no input + remote templated
     - no input + local templated
- create template component
- create File *send* attruibte to send content over http request
 - -> <File name='?' src='http://' send={method:'post', headers:{}} result_on={[true, 200, 201, '2**', '400']}>{CONTENT}</File>

- create File *pipe* attruibte to create a 'named pipe'
 - -> <File name='?' src='.' link>{CONTENT}</File>


- create File *link* attruibte to create a symbolic link
- Create File *result_on* attribute to handle results of cmd, and src ()
- create File *fifo* attribute to create a named pipe (temporary file)
- move console outside of this repo infot fileab-cli (not particularly useful here)
 - make **render** sole export


- create *Link* component to create a symbolic link or web shortcut
 - -> <Link target='...' />

- create "fileable-cloud" to write contents to cloud service
 - aws s3
 - google
 - azuer
