import { MeetingParams } from "./types"

class Global{
    private static instance: Global
    private meetingParams:MeetingParams | null = null
    public constructor() {}

    public set(meetingParams:MeetingParams){
        if(this.meetingParams === null){
            throw new Error("Meeting params are already set")
        }
        this.meetingParams = meetingParams
    }

    public get():MeetingParams{
        if(this.meetingParams === null){
            throw new Error("Meeting params are not set")
        }
        return this.meetingParams
    }

    public isServerless():boolean{
        if(this.meetingParams === null){
            throw new Error("Meeting params are not set")
        }
        return this.meetingParams.remote === null
    }
}

 export let GLOBAL = new Global()  