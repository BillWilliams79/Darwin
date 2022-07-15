/*DROP DATABASE darwin;
*/

CREATE DATABASE IF NOT EXISTS darwin;
USE darwin;

CREATE TABLE IF NOT EXISTS profiles (
	PRIMARY KEY (id),
    id					INT					NOT NULL AUTO_INCREMENT UNIQUE,
    name	 			VARCHAR(256)		NOT NULL,
    email				VARCHAR(256)		NOT NULL,
    subject				VARCHAR(64)			NOT NULL,
    userName			VARCHAR(256)		NOT NULL,
    region				VARCHAR(128)		NOT NULL,
    userPoolId			VARCHAR(128)		NOT NULL,
    create_ts	        TIMESTAMP 			NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts			TIMESTAMP			NULL ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domains (
    id 							INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    domain_name 				VARCHAR(32)	NOT NULL,
    creator_fk 					INT				NULL,
    create_ts       			TIMESTAMP 		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS areas (
    id							INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    area_name 					VARCHAR(32)	NOT NULL,
    domain_fk					INT				NULL,
	creator_fk					INT				NULL,
    create_ts        			TIMESTAMP 		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
	FOREIGN KEY (domain_fk)
        REFERENCES domains (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id		 					INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    priority					BOOLEAN			NOT NULL,
    done						BOOLEAN			NOT NULL,
    description					VARCHAR(256)	NOT NULL,
    area_fk						INT				NULL,
	creator_fk					INT				NULL,
    create_ts        			TIMESTAMP		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    done_ts     				TIMESTAMP		NULL,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (area_fk)
        REFERENCES areas (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

/* one sample record per table for testing */
INSERT INTO profiles (name, email, subject, userName, region, userPoolId)
VALUES ('Billw', 'divebilldive@gmail.com', '12345', '12345', 'California', '12345');

INSERT INTO domains (domain_name, creator_fk) 
VALUES ('Art', 1);

INSERT INTO areas (area_name, domain_fk, creator_fk) 
VALUES ('Pencil Drawings', 1, 1);

INSERT INTO tasks (priority, done, description, area_fk, creator_fk) 
VALUES (true, false, "Draw a picture of Ava, Lia and Ella", 1, 1);

/* Display a three table star join to confirm tables and constraints function */
SELECT 
    priority as 'Priority',
    done as 'Done',
    description as 'Description',
    areas.area_name AS 'Area Name',
    profiles.name AS 'User Name',
    tasks.create_ts AS 'Created',
    tasks.update_ts AS 'Updated',
    tasks.done_ts AS 'Was Done'
FROM
    tasks
        INNER JOIN profiles
			ON tasks.creator_fk = profiles.id
		INNER JOIN areas
			ON tasks.area_fk = areas.id;
