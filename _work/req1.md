This looks good. Can we get to the real implementation?

I want below stages. I want my workflow engine to be advanced and want to implemnt most of the control patterns here: http://www.workflowpatterns.com/patterns/control/

Each stage may have a different set of verticices, which  I can connect to other stages, thus establishing linkes. Ex. INstead of just one link from stage A to stage B, I may have multiple. Ex. most of the stages will provide paths for error, success. Loop stage will provide link for Next.. 

Control Patterns
1. Start Stage
2. Stop Stage
3. Loop Stage (Loops)
4. Parallel Split
5. Exclusive Choice (Switch ?)
6. Multi Choice (If else?)
7. Thread Split
8. Thread Join
9, Simple Merge
10. Synchrinization Merge
11. Pause Stage/Wait for Approvals
12. Triggers (Ex, callbacks, scheduler, approavals) 
13. Call another workflow stage


Tasks (Lets focus this section for end users - who dont have any programming experience): 
1. Send Mail
2. Notify User (We need to implement a notifications inbox)
3. String Template (which I can use for customizing templates)
4. LLM Agent Stage (where we use predefined agents & prompts)
5. Execute Process Stage (I am thinking like executing CLI commands, that can be anything, like kubectl get pods)
6. Custom LLM Agent Stage (where we have the capability to define the prompt dynamically)
7. Task Approval Stage
8. API call stage (this is going to be the complex of all - think of like, the entire curl/wget features, but can be configurable)

Intermediate
1. CSV Writer
2. CSV Reader
3. Image Writer
4. Image Reader
5. Word Document producer (thinking if we want to produce reports - not sure how we will achieve this)
6. PDF Generator (not sure how we will get this)

Advanced (Lets focus this section for programmers - who want to automate their workflow)
1. MySQL Query Executor Stage
2. Postgres Query Executor Stage
3. MongoDB Query Executor Stage
4. AWS Kinesis Stage
5. AWS SQS Stage
6. AWS S3 Stage
7. Kubernetes Stage ( we need to be able to tell namespace, kind, and operation)
8. CloudWatch Stage
9. Inline script execution stage (Our backend is in Java - which scripting language we can use? groovy? this may impoact the program's java objects - I dont have any idea how we will do this.
We can expand to other advanced stages once we get through this basic.

Ultimately, using these stages, we should be able to automate most of the Enduser workflows, DevOps, SRE, Security workflows. WE need to add more id required.

Primary motive behind this: Everyone in the world should have access to basic AI workflows by default. Think of a an AI Utility device (Robots). Also Local LLMs are the primary LLM Agents (It may not be realistic now. But we should prepare for teh event that everyone will be running LLMs in their home)