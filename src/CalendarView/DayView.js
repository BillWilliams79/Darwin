import React, { useState } from 'react'

import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import { Typography } from '@mui/material';

const DayView = (date) => {

    const [tasksArray, setTasksArray] = useState();

    return (

        <Card key={areaIndex} raised={true}>
            <CardContent>
                <Box className="card-header" sx={{marginBottom: 2}}>
                    <Typography>
                        {date}
                    </Typography>
                    <Typography>
                        Weekday
                    </Typography>
                </Box>
                { tasksArray &&
                    tasksArray.map((task, taskIndex) => (
                        <Task task = {task}
                              key = {task.id}
                              taskIndex = {taskIndex}
/*                               areaId = {area.id}
                              priorityClick = {priorityClick}
                              doneClick = {doneClick}
                              descriptionChange = {descriptionChange}
                              descriptionKeyDown = {descriptionKeyDown} 
                              descriptionOnBlur = {descriptionOnBlur}
                              deleteClick = {deleteClick}  */>
                        </Task>
                    ))
                }
            </CardContent>
        </Card>
    )
}

export default DayView